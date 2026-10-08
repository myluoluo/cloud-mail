import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateEmailStatus } = vi.hoisted(() => ({ updateEmailStatus: vi.fn() }));
vi.mock('../src/service/email-service', () => ({ default: { updateEmailStatus } }));

const { default: app } = await import('../src/hono/webs');
const { default: worker } = await import('../src/index.js');

function makeSecret() {
	return `whsec_${randomBytes(32).toString('base64')}`;
}

function sign(secret, id, ts, payload) {
	const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
	return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`, 'utf8').digest('base64')}`;
}

function post(secret, payload, { withSignature = true, envSecret = secret } = {}) {
	const headers = buildHeaders(secret, payload, withSignature);
	return app.fetch(
		new Request('https://mail.haitang.de/webhooks', { method: 'POST', headers, body: payload }),
		{ resend_webhook_secret: envSecret }
	);
}

function buildHeaders(secret, payload, withSignature) {
	const id = 'msg_test_1';
	const ts = String(Math.floor(Date.now() / 1000));
	const headers = { 'Content-Type': 'application/json' };
	if (withSignature) {
		headers['svix-id'] = id;
		headers['svix-timestamp'] = ts;
		headers['svix-signature'] = sign(secret, id, ts, payload);
	}
	return headers;
}

// 走生产入口：/api 前缀剥离 + new Request(url, req) 重建，验证重建后 body 与 svix 头仍可用于验签
function postViaWorker(secret, payload, { withSignature = true, envSecret = secret } = {}) {
	const headers = buildHeaders(secret, payload, withSignature);
	return worker.fetch(
		new Request('https://mail.haitang.de/api/webhooks', { method: 'POST', headers, body: payload }),
		{ resend_webhook_secret: envSecret },
		{}
	);
}

describe('POST /webhooks 入站校验', () => {

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('未携带任何签名头的伪造事件返回 401，且不写库', async () => {
		const payload = JSON.stringify({ type: 'email.failed', data: { email_id: 'eid-1', failed: { reason: 'forged' } } });
		const res = await post(makeSecret(), payload, { withSignature: false });

		expect(res.status).toBe(401);
		expect(await res.text()).toBe('Unauthorized');
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('签名密钥不匹配返回 401', async () => {
		const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'eid-1' } });
		// 用另一把密钥签名，服务端持有的是 envSecret
		const res = await post(makeSecret(), payload, { envSecret: makeSecret() });

		expect(res.status).toBe(401);
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('未配置签名密钥时 fail-closed 返回 401', async () => {
		const secret = makeSecret();
		const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'eid-1' } });
		const res = await post(secret, payload, { envSecret: '' });

		expect(res.status).toBe(401);
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});

	it('合法签名的事件返回 200 并更新状态', async () => {
		const secret = makeSecret();
		const payload = JSON.stringify({ type: 'email.bounced', data: { email_id: 'eid-1', bounce: { type: 'hard' } } });
		updateEmailStatus.mockResolvedValue({ emailId: 1 });

		const res = await post(secret, payload);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe('success');
		expect(updateEmailStatus).toHaveBeenCalledWith(expect.anything(), {
			resendEmailId: 'eid-1',
			status: 3,
			message: JSON.stringify({ type: 'hard' }),
		});
	});

	it('非法 JSON 返回 400，不回显内部错误', async () => {
		const secret = makeSecret();
		const res = await post(secret, '{not-json');

		expect(res.status).toBe(400);
		expect(await res.text()).toBe('Invalid payload');
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});
});

describe('POST /api/webhooks 生产入口', () => {

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('经 /api 前缀剥离与 Request 重建后，合法签名仍能验签并更新状态', async () => {
		const secret = makeSecret();
		const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'eid-1' } });
		updateEmailStatus.mockResolvedValue({ emailId: 1 });

		const res = await postViaWorker(secret, payload);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe('success');
		expect(updateEmailStatus).toHaveBeenCalledWith(expect.anything(), {
			resendEmailId: 'eid-1',
			status: 2,
			message: null,
		});
	});

	it('经生产入口的未签名伪造事件返回 401，且不写库', async () => {
		const payload = JSON.stringify({ type: 'email.bounced', data: { email_id: 'eid-1', bounce: { type: 'forged' } } });

		const res = await postViaWorker(makeSecret(), payload, { withSignature: false });

		expect(res.status).toBe(401);
		expect(await res.text()).toBe('Unauthorized');
		expect(updateEmailStatus).not.toHaveBeenCalled();
	});
});
