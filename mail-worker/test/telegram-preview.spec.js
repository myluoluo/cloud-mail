import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getEmail, querySetting } = vi.hoisted(() => ({
	getEmail: vi.fn(),
	querySetting: vi.fn()
}));

vi.mock('../src/entity/orm', () => ({
	default: () => ({
		select: () => ({ from: () => ({ where: () => ({ get: getEmail }) }) })
	})
}));
vi.mock('../src/service/setting-service', () => ({ default: { query: querySetting } }));

import telegramService from '../src/service/telegram-service';
import jwtUtils from '../src/utils/jwt-utils';
import worker from '../src/index';

const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;
const ISSUED_AT = new Date('2026-10-09T00:00:00Z');
let context;
let sendMessage;

async function newPreviewToken() {
	await telegramService.sendEmailToBot(context, {
		emailId: 12345,
		subject: '测试邮件',
		text: 'private mail body'
	});
	const body = JSON.parse(sendMessage.mock.calls[0][1].body);
	const url = body.reply_markup.inline_keyboard[0][0].web_app.url;
	return new URL(url).pathname.split('/').at(-1);
}

function preview(token) {
	return worker.fetch(
		new Request(`https://mail.example.com/api/telegram/getEmail/${token}`),
		context.env,
		{}
	);
}

describe('Telegram Quick View 三天有效期', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(ISSUED_AT);
		context = { env: { jwt_secret: randomBytes(32).toString('hex') } };
		querySetting.mockResolvedValue({
			tgBotToken: 'test-bot',
			tgChatId: '1',
			customDomain: 'mail.example.com',
			tgMsgText: 'hide'
		});
		getEmail.mockResolvedValue({ emailId: 12345, text: 'private mail body' });
		sendMessage = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
		vi.stubGlobal('fetch', sendMessage);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('实际通知中的预览链接带有三天后的签名过期时间', async () => {
		const token = await newPreviewToken();
		const payload = await jwtUtils.verifyToken(context, token);

		expect(payload.emailId).toBe(12345);
		expect(payload.exp - payload.iat).toBe(THREE_DAYS_SECONDS);
	});

	it.each(['new', 'legacy'])('%s 链接在三天前可读，到三天时拒绝且不读取邮件', async (kind) => {
		const token = kind === 'new'
			? await newPreviewToken()
			: await jwtUtils.generateToken(context, { emailId: 12345 });

		vi.setSystemTime(ISSUED_AT.getTime() + THREE_DAYS_SECONDS * 1000 - 1);
		const valid = await preview(token);
		expect(await valid.text()).toContain('private mail body');

		getEmail.mockClear();
		vi.setSystemTime(ISSUED_AT.getTime() + THREE_DAYS_SECONDS * 1000);
		const expired = await preview(token);
		expect(await expired.text()).toContain('Access denied');
		expect(getEmail).not.toHaveBeenCalled();
	});

	it('有效和过期的预览响应均禁止缓存', async () => {
		const token = await newPreviewToken();
		const valid = await preview(token);
		expect(valid.headers.get('Cache-Control')).toBe('private, no-store');

		vi.setSystemTime(ISSUED_AT.getTime() + THREE_DAYS_SECONDS * 1000);
		const expired = await preview(token);
		expect(expired.headers.get('Cache-Control')).toBe('private, no-store');
	});

	it('其他用途的 JWT 不受预览三天期限影响', async () => {
		const token = await jwtUtils.generateToken(context, { userId: 1 }, 7 * 24 * 60 * 60);
		vi.setSystemTime(ISSUED_AT.getTime() + 4 * 24 * 60 * 60 * 1000);

		expect((await jwtUtils.verifyToken(context, token)).userId).toBe(1);
	});
});
