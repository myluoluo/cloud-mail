import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';
import jwtUtils from '../src/utils/jwt-utils';

const { query, selectByEmailIncludeDel, updateUserInfo } = vi.hoisted(() => ({
	query: vi.fn(), selectByEmailIncludeDel: vi.fn(), updateUserInfo: vi.fn()
}));
vi.mock('../src/service/setting-service', () => ({ default: { query } }));
vi.mock('../src/service/user-service', () => ({ default: { selectByEmailIncludeDel, updateUserInfo } }));

const { default: loginService } = await import('../src/service/login-service');
const { default: worker } = await import('../src/index');

describe('密码登录 Turnstile 验证', () => {
	let c;
	let fetchMock;

	beforeEach(async () => {
		vi.clearAllMocks();
		query.mockResolvedValue({ siteKey: 'site-key', secretKey: 'test-secret' });
		const { salt, hash } = await cryptoUtils.hashPassword('correct-password');
		selectByEmailIncludeDel.mockResolvedValue({
			userId: 7, email: 'user@example.com', salt, password: hash, isDel: 0, status: 0
		});
		c = {
			req: { url: 'https://mail.example.com/login', header: () => '192.0.2.1' },
			env: { jwt_secret: 'test-jwt-secret', kv: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } }
		};
		fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, action: 'login', hostname: 'mail.example.com' }));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => vi.unstubAllGlobals());

	it('缺少 token 时拒绝登录，且不查询账号', async () => {
		await expect(loginService.login(c, { email: 'user@example.com', password: 'correct-password' })).rejects.toThrow();
		expect(selectByEmailIncludeDel).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		{ success: false },
		{ success: true, action: 'register', hostname: 'mail.example.com' },
		{ success: true, action: 'login', hostname: 'other.example.com' }
	])('无效或其他操作、域名的 token 不进入账号查询：%j', async response => {
		fetchMock.mockResolvedValue(Response.json(response));
		await expect(loginService.login(c, { email: 'user@example.com', password: 'correct-password', token: 'test-token' })).rejects.toThrow();
		expect(selectByEmailIncludeDel).not.toHaveBeenCalled();
	});

	it('验证通过后仍校验密码，并签发可验证的登录会话', async () => {
		const token = await loginService.login(c, { email: 'user@example.com', password: 'correct-password', token: 'test-token' });
		expect(await jwtUtils.verifyToken(c, token)).toMatchObject({ userId: 7 });
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
		expect(options.body.get('response')).toBe('test-token');
		expect(options.body.get('remoteip')).toBe('192.0.2.1');
		expect(c.env.kv.put).toHaveBeenCalledOnce();
	});

	it('验证通过但密码错误时不签发会话', async () => {
		await expect(loginService.login(c, { email: 'user@example.com', password: 'wrong-password', token: 'test-token' })).rejects.toThrow();
		expect(c.env.kv.put).not.toHaveBeenCalled();
	});

	it('未配置 Turnstile 的站点继续使用密码登录', async () => {
		query.mockResolvedValue({ siteKey: '', secretKey: '' });
		const token = await loginService.login(c, { email: 'user@example.com', password: 'correct-password' });
		expect(await jwtUtils.verifyToken(c, token)).toMatchObject({ userId: 7 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('已验证的 OAuth 内部登录不要求密码验证码', async () => {
		const token = await loginService.login(c, { email: 'user@example.com', password: null }, true);
		expect(await jwtUtils.verifyToken(c, token)).toMatchObject({ userId: 7 });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('公网请求不能通过 JSON 参数跳过验证码', async () => {
		const response = await worker.fetch(new Request('https://mail.example.com/api/login', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: 'user@example.com', password: 'correct-password', noVerifyPwd: true })
		}), c.env, {});
		expect((await response.json()).code).toBe(400);
		expect(selectByEmailIncludeDel).not.toHaveBeenCalled();
	});
});
