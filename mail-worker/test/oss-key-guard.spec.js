import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { getTableColumns } from 'drizzle-orm';

import r2Service from '../src/service/r2-service';
import fileUtils from '../src/utils/file-utils';
import constant from '../src/const/constant';
import s3Service from '../src/service/s3-service';
import attService from '../src/service/att-service';
import { att } from '../src/entity/att';

afterEach(() => vi.restoreAllMocks());

function createContext() {
	const getWithMetadata = vi.fn(async () => ({
		value: new Uint8Array([1, 2, 3]).buffer,
		metadata: { contentType: 'image/webp' }
	}));
	const c = {
		env: {
			r2: undefined,
			domain: ['haitang.de'],
			kv: { getWithMetadata }
		},
		get: () => ({ bucket: '', endpoint: '', s3AccessKey: '', s3SecretKey: '' })
	};
	return { c, getWithMetadata };
}

describe('公开对象读取键隔离', () => {
	let c;
	let getWithMetadata;

	beforeEach(() => {
		({ c, getWithMetadata } = createContext());
	});

	it.each([
		'setting:',
		'public_key:',
		'auth-uid:1',
		'send_day_count:2026-10-08',
		'analysis_echarts:UTC',
		'oauth:pocket-id:state:abc'
	])('系统 KV 键 %s 不可经读取面读出', async (key) => {
		await expect(r2Service.getObj(c, key)).resolves.toBeNull();
		await expect(r2Service.toObjResp(c, key)).resolves.toBeNull();
		expect(getWithMetadata).not.toHaveBeenCalled();
	});

	it.each([
		'',
		undefined,
		null,
		123,
		'static',
		'/static/background/x.webp',
		'../setting:',
		'Static/background/x.webp',
		'static%2Fbackground%2Fx.webp',
		'%73tatic/private.png',
		'attachments%2fabc.png',
		'attachments-abc/x.png'
	])('非公开对象键 %s 被拒绝且不触碰存储', async (key) => {
		await expect(r2Service.getObj(c, key)).resolves.toBeNull();
		await expect(r2Service.toObjResp(c, key)).resolves.toBeNull();
		expect(getWithMetadata).not.toHaveBeenCalled();
	});

	it.each([
		'static/background/fc9ea4a7d9ac36321d9d5a34e7f0c346.webp',
		'attachments/abc123.png',
		// 附件后缀直接取自外部邮件文件名，冒号与百分号都必须仍能读回
		'attachments/abc123.pdf:metadata',
		'attachments/abc123.pdf%',
		'static/background/a%20b.webp'
	])('公开对象键 %s 正常放行', async (key) => {
		const resp = await r2Service.toObjResp(c, key);
		expect(resp).toBeInstanceOf(Response);
		expect(getWithMetadata).toHaveBeenCalledWith(key, { type: 'arrayBuffer' });
	});

	it('getObj 与 toObjResp 使用同一个 key，不做解码改写', async () => {
		await expect(r2Service.getObj(c, 'attachments/a%2Eb.png')).resolves.toBeInstanceOf(Response);
		expect(getWithMetadata).toHaveBeenCalledWith('attachments/a%2Eb.png', { type: 'arrayBuffer' });
	});

	it('白名单前缀下的穿越写法只读字面键，读不到系统键', async () => {
		await r2Service.toObjResp(c, 'static/../setting:');
		expect(getWithMetadata).toHaveBeenCalledWith('static/../setting:', { type: 'arrayBuffer' });
		expect(getWithMetadata).not.toHaveBeenCalledWith('setting:', expect.anything());
	});

	// 真实写入键由 email.js / att-service.js / setting-service.js 构造：
	// 附件 = 'attachments/' + hash + 文件名最后一个点之后的后缀，背景图 = 'static/background/' + hash + 后缀。
	// 外部邮件文件名完全可控，这些形态都必须仍能被读回。
	it.each([
		'report.pdf',
		'my report.pdf',
		'report.pdf%',
		'report.pdf%5c',
		'report.pdf:metadata',
		'report.pdf 中文'
	])('真实附件写入键（文件名 %s）可被读回', async (filename) => {
		const key = constant.ATTACHMENT_PREFIX
			+ await fileUtils.getBuffHash(new Uint8Array([1]))
			+ fileUtils.getExtFileName(filename);
		await expect(r2Service.toObjResp(c, key)).resolves.toBeInstanceOf(Response);
		expect(getWithMetadata).toHaveBeenCalledWith(key, { type: 'arrayBuffer' });
	});

	it('真实背景图写入键可被读回', async () => {
		const key = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(new Uint8Array([2])) + '.webp';
		await expect(r2Service.toObjResp(c, key)).resolves.toBeInstanceOf(Response);
		expect(getWithMetadata).toHaveBeenCalledWith(key, { type: 'arrayBuffer' });
	});

	it.each(['KV', 'R2', 'S3'])('%s 返回的历史 HTML/SVG 内联对象必须隔离并强制下载', async storage => {
		for (const mime of ['text/html; charset=utf-8', 'image/svg+xml']) {
			const content = '<p>静态附件标记</p>';
			const metadata = {contentType: mime, contentDisposition: 'inline;filename=mail.html'};
			getWithMetadata.mockResolvedValue({value: new TextEncoder().encode(content), metadata});
			if (storage === 'R2') {
				c.env.r2 = {get: vi.fn(async () => ({body: content, httpMetadata: metadata}))};
			} else if (storage === 'S3') {
				c.get = () => ({bucket: 'test', endpoint: 'https://storage.example', s3AccessKey: 'test', s3SecretKey: 'test'});
				vi.spyOn(s3Service, 'client').mockResolvedValue({send: async () => ({Body: content, ContentType: mime, ContentDisposition: metadata.contentDisposition})});
			}
			const response = await r2Service.toObjResp(c, 'attachments/old.html');
			expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(response.headers.get('Content-Disposition')).toBe('attachment');
			expect(await response.text()).toBe(content);
		}
	});

	it('栅格图片保留类型和内联显示，缺失对象仍返回 null', async () => {
		getWithMetadata.mockResolvedValue({value: new Uint8Array([1, 2, 3]), metadata: {contentType: 'image/png', contentDisposition: 'inline;filename=picture.png'}});
		const response = await r2Service.toObjResp(c, 'attachments/picture.png');
		expect(response.headers.get('Content-Type')).toBe('image/png');
		expect(response.headers.get('Content-Disposition')).toBe('inline;filename=picture.png');
		expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
		getWithMetadata.mockResolvedValue({value: null});
		await expect(r2Service.toObjResp(c, 'attachments/missing')).resolves.toBeNull();
	});

	it.each([
		['text/html', '<cid>', 'attachment'],
		['image/svg+xml', '<cid>', 'attachment'],
		['image/png', '<cid>', 'inline'],
		['image/png', undefined, 'attachment'],
	])('保存入站附件 %s、Content-ID %s 时使用 %s', async (mimeType, contentId, disposition) => {
		const sqlite = new DatabaseSync(':memory:');
		const columns = Object.values(getTableColumns(att)).map(column => `${column.name} ${column.dataType === 'number' ? 'INTEGER' : 'TEXT'}`);
		sqlite.exec(`CREATE TABLE attachments (${columns.join(', ')})`);
		c.env.db = {prepare(query) {
			const statement = sqlite.prepare(query);
			return {bind: (...values) => ({run: async () => statement.run(...values)})};
		}};
		c.env.kv.put = vi.fn();
		try {
			await attService.addAtt(c, [{key: 'attachments/test', filename: 'test', mimeType, contentId, content: new Uint8Array([1])}]);
			expect(c.env.kv.put.mock.calls[0][2].metadata.contentDisposition).toBe(`${disposition};filename=test`);
			expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attachments').get().count).toBe(1);
		} finally {
			sqlite.close();
		}
	});
});
