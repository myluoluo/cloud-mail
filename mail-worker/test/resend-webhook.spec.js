import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Resend } from 'resend';

const { updateEmailStatus } = vi.hoisted(() => ({ updateEmailStatus: vi.fn() }));
vi.mock('../src/service/email-service', () => ({ default: { updateEmailStatus } }));

const { default: resendService } = await import('../src/service/resend-service');
const { verifySvixSignature } = await import('../src/utils/svix-utils');

function makeSecret() {
	return `whsec_${randomBytes(32).toString('base64')}`;
}

function sign(secret, id, ts, payload) {
	const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
	return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`, 'utf8').digest('base64')}`;
}

function makeContext({ secret, id = 'msg_test_1', ts = String(Math.floor(Date.now() / 1000)), sig = '' } = {}) {
	const headers = {
		'svix-id': id,
		'svix-timestamp': ts,
		'svix-signature': sig,
	};
	return {
		env: { resend_webhook_secret: secret },
		req: { header: name => headers[name] ?? null },
	};
}

function signedContext(secret, payload) {
	const id = 'msg_test_1';
	const ts = String(Math.floor(Date.now() / 1000));
	return makeContext({ secret, id, ts, sig: sign(secret, id, ts, payload) });
}

describe('verifySvixSignature', () => {

	it('有效签名通过', async () => {
		const secret = makeSecret();
		const payload = '{"type":"email.delivered","data":{"email_id":"eid-1"}}';
		const id = 'msg_1';
		const ts = String(Math.floor(Date.now() / 1000));
		const ok = await verifySvixSignature({
			secret,
			headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, payload) },
			payload,
		});
		expect(ok).toBe(true);
	});

	it('篡改 body 后签名不通过', async () => {
		const secret = makeSecret();
		const payload = '{"type":"email.delivered","data":{"email_id":"eid-1"}}';
		const id = 'msg_1';
		const ts = String(Math.floor(Date.now() / 1000));
		const ok = await verifySvixSignature({
			secret,
			headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, payload) },
			payload: payload.replace('eid-1', 'eid-2'),
		});
		expect(ok).toBe(false);
	});

	it('缺签名头不通过', async () => {
		const ok = await verifySvixSignature({
			secret: makeSecret(),
			headers: { 'svix-id': '', 'svix-timestamp': '', 'svix-signature': '' },
			payload: '{}',
		});
		expect(ok).toBe(false);
	});

	it('过期时间戳不通过（重放防护）', async () => {
		const secret = makeSecret();
		const payload = '{}';
		const id = 'msg_1';
		const ts = String(Math.floor(Date.now() / 1000) - 601);
		const ok = await verifySvixSignature({
			secret,
			headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, payload) },
			payload,
		});
		expect(ok).toBe(false);
	});

	it('密钥错误不通过', async () => {
		const secret = makeSecret();
		const payload = '{}';
		const id = 'msg_1';
		const ts = String(Math.floor(Date.now() / 1000));
		const ok = await verifySvixSignature({
			secret: makeSecret(),
			headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, payload) },
			payload,
		});
		expect(ok).toBe(false);
	});

	it('与 Resend 官方 SDK 的验签结果一致', async () => {
		const secret = makeSecret();
		const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'eid-1' } });
		const id = 'msg_1';
		const ts = String(Math.floor(Date.now() / 1000));
		const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, payload) };

		// 官方 SDK 用 svix-id/svix-timestamp/svix-signature 头，不接 webhook-* 别名
		const official = new Resend('re_test');
		expect(() => official.webhooks.verify({
			payload,
			webhookSecret: secret,
			headers: { id, timestamp: ts, signature: headers['svix-signature'] },
		})).not.toThrow();

		expect(await verifySvixSignature({ secret, headers, payload })).toBe(true);
	});
});

describe('resendService.webhooks', () => {

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('有效 delivered 事件更新状态', async () => {
		const secret = makeSecret();
		const body = { type: 'email.delivered', data: { email_id: 'eid-1' } };
		const rawBody = JSON.stringify(body);
		updateEmailStatus.mockResolvedValue({ emailId: 1 });
		const c = signedContext(secret, rawBody);

		await resendService.webhooks(c, rawBody);

		expect(updateEmailStatus).toHaveBeenCalledWith(c, {
			resendEmailId: 'eid-1',
			status: 2,
			message: null,
		});
	});

	it('无签名请求抛 401，不触达 DB', async () => {
		const c = makeContext({ secret: makeSecret() });
		const body = { type: 'email.delivered', data: { email_id: 'eid-1' } };
		await expect(resendService.webhooks(c, JSON.stringify(body)))
			.rejects.toMatchObject({ code: 401 });
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('未配置密钥时直接 401（fail-closed）', async () => {
		const c = makeContext({ secret: '' });
		const body = { type: 'email.delivered', data: { email_id: 'eid-1' } };
		await expect(resendService.webhooks(c, JSON.stringify(body)))
			.rejects.toMatchObject({ code: 401 });
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('未知事件类型直接 ack，不写 DB', async () => {
		const secret = makeSecret();
		const body = { type: 'email.opened', data: { email_id: 'eid-1' } };
		const rawBody = JSON.stringify(body);
		const c = signedContext(secret, rawBody);

		await resendService.webhooks(c, rawBody);

		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('failed 事件缺 failed 字段不抛错', async () => {
		const secret = makeSecret();
		const body = { type: 'email.failed', data: { email_id: 'eid-1' } };
		const rawBody = JSON.stringify(body);
		updateEmailStatus.mockResolvedValue({ emailId: 1 });
		const c = signedContext(secret, rawBody);

		await resendService.webhooks(c, rawBody);

		expect(updateEmailStatus).toHaveBeenCalledWith(c, {
			resendEmailId: 'eid-1',
			status: 8,
			message: null,
		});
	});

	it('无匹配行也 ack，不抛“更新失败”', async () => {
		const secret = makeSecret();
		const body = { type: 'email.failed', data: { email_id: 'nope', failed: { reason: 'x' } } };
		const rawBody = JSON.stringify(body);
		updateEmailStatus.mockResolvedValue(null);
		const c = signedContext(secret, rawBody);

		await expect(resendService.webhooks(c, rawBody)).resolves.toBeUndefined();
	});

	it('缺 type 的签名请求直接 ack，不写 DB', async () => {
		const secret = makeSecret();
		const rawBody = '{}';
		const c = signedContext(secret, rawBody);

		await resendService.webhooks(c, rawBody);

		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('body 不是对象时抛 400', async () => {
		const secret = makeSecret();
		const rawBody = '[]';
		const c = signedContext(secret, rawBody);
		await expect(resendService.webhooks(c, rawBody))
			.rejects.toMatchObject({ code: 400 });
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('缺 email_id 抛 400', async () => {
		const secret = makeSecret();
		const body = { type: 'email.delivered', data: {} };
		const rawBody = JSON.stringify(body);
		const c = signedContext(secret, rawBody);
		await expect(resendService.webhooks(c, rawBody))
			.rejects.toMatchObject({ code: 400 });
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});
});
