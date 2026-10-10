import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import telegramService from '../src/service/telegram-service';
import jwtUtils from '../src/utils/jwt-utils';
import KvConst from '../src/const/kv-const';

let env;
let outbound;

beforeEach(() => {
	const records = new Map([
		[KvConst.SETTING, { tgBotToken: 'test-bot', customDomain: 'mail.example.com', emailPrefixFilter: '' }],
		[KvConst.AUTH_INFO + 1, {
			user: { userId: 1, email: 'user@example.com' },
			tokens: ['user-session'], refreshTime: new Date().toISOString()
		}],
		[KvConst.AUTH_INFO + 2, {
			user: { userId: 2, email: 'admin@example.com' },
			tokens: ['admin-session'], refreshTime: new Date().toISOString()
		}]
	]);
	env = {
		jwt_secret: randomBytes(32).toString('hex'),
		admin: 'admin@example.com',
		domain: ['example.com'],
		kv: { get: vi.fn(async key => records.get(key) ?? null) }
	};
	// 只隔离 Telegram 外发请求；路由、JWT、会话与设置读取均走生产实现。
	outbound = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} })));
	vi.stubGlobal('fetch', outbound);
});

afterEach(() => vi.unstubAllGlobals());

function request({ path, headers = {}, body }) {
	return worker.fetch(new Request(`https://mail.example.com${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	}), env, {});
}

describe.each(['/api/telegram/webhook', '/telegram/webhook'])('Telegram 入站鉴权 %s', path => {
	it.each([undefined, '', 'wrong'])('缺失、空值或错误 secret %s 被拒绝且不发送消息', async secret => {
		const headers = secret === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret };
		const response = await request({ path, headers, body: {
			update_id: 1, message: { chat: { id: 123 }, text: '/start' }
		} });
		expect(response.status).toBe(401);
		expect(await response.text()).toBe('Unauthorized');
		expect(outbound).not.toHaveBeenCalled();
	});

	it('注册使用的正确 secret 可以处理命令，无需网站登录', async () => {
		const secret = await telegramService.getWebhookSecret({ env }, 'test-bot');
		const response = await request({ path,
			headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
			body: { update_id: 1, message: { chat: { id: 123 }, text: '/help' } }
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
		expect(outbound).toHaveBeenCalledTimes(1);
		expect(outbound.mock.calls[0][0]).toBe('https://api.telegram.org/bottest-bot/sendMessage');
		expect(JSON.parse(outbound.mock.calls[0][1].body)).toMatchObject({ chat_id: 123 });
	});
});

describe.each(['webhookInfo', 'setupWebhook', 'setWebhook'])('Telegram 管理权限 %s', route => {
	it.each([
		['普通用户会话', { userId: 1, token: 'user-session' }, 403],
		['邮件预览 JWT', { emailId: 42 }, 401],
		['已撤销的管理员会话', { userId: 2, token: 'revoked-session' }, 401]
	])('%s 不能管理 webhook', async (_label, payload, code) => {
		const token = await jwtUtils.generateToken({ env }, payload, 3600);
		const response = await request({ path: `/api/telegram/${route}`, headers: { Authorization: token } });
		expect((await response.json()).code).toBe(code);
		expect(outbound).not.toHaveBeenCalled();
	});

	it('有效管理员会话可以执行管理操作', async () => {
		const token = await jwtUtils.generateToken({ env }, { userId: 2, token: 'admin-session' }, 3600);
		const response = await request({ path: `/api/telegram/${route}`, headers: { Authorization: token } });
		expect((await response.json()).code).toBe(200);
		const method = route === 'webhookInfo' ? 'getWebhookInfo' : 'setWebhook';
		expect(outbound.mock.calls[0][0]).toBe(`https://api.telegram.org/bottest-bot/${method}`);
		if (route !== 'webhookInfo') {
			const secret = await telegramService.getWebhookSecret({ env }, 'test-bot');
			expect(JSON.parse(outbound.mock.calls[0][1].body)).toMatchObject({
				url: 'https://mail.example.com/api/telegram/webhook', secret_token: secret
			});
		}
	});
});

it.each(['missing', 'header-secret', 'query-secret'])('管理接口不接受无会话凭据 %s', async credential => {
	const headers = credential === 'header-secret' ? { Authorization: env.jwt_secret } : {};
	const query = credential === 'query-secret' ? `?secret=${env.jwt_secret}` : '';
	const response = await request({ path: `/api/telegram/webhookInfo${query}`, headers });
	expect((await response.json()).code).toBe(401);
	expect(outbound).not.toHaveBeenCalled();
});
