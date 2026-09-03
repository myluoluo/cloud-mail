import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateRun = vi.fn();
const updateSet = vi.fn(() => ({ where: () => ({ run: updateRun }) }));
const orm = vi.fn(() => ({ update: () => ({ set: updateSet }) }));
const exchangeCode = vi.fn();
const selectByIdIncludeDel = vi.fn();
const login = vi.fn();

vi.mock('../src/entity/orm', () => ({ default: orm }));
vi.mock('../src/service/pocket-id-service', () => ({
	default: { exchangeCode }
}));
vi.mock('../src/service/user-service', () => ({
	default: { selectByIdIncludeDel }
}));
vi.mock('../src/service/login-service', () => ({
	default: { login }
}));
vi.mock('../src/service/setting-service', () => ({
	default: { query: vi.fn() }
}));

const { default: oauthService } = await import('../src/service/oauth-service');

describe('Pocket ID 管理员绑定', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('把已验证的 Pocket ID 身份关联到发起绑定的现有管理员', async () => {
		const c = { env: { admin: 'admin@haitang.de' } };
		exchangeCode.mockResolvedValue({
			userId: 42,
			sub: 'pocket-user-id',
			email: 'i@521.moe',
			username: 'xiaobo',
			name: 'Xiaobo'
		});
		selectByIdIncludeDel.mockResolvedValue({
			userId: 42,
			email: 'admin@haitang.de',
			isDel: 0,
			status: 0
		});
		vi.spyOn(oauthService, 'getByIdentity').mockResolvedValue({
			oauthUserId: 'pocket-user-id',
			platform: 'pocketid',
			userId: 0
		});
		login.mockResolvedValue('local-jwt');

		const result = await oauthService.pocketIdLogin(c, {
			code: 'code',
			state: 'state',
			redirectUri: 'https://mail.haitang.de/login'
		}, 'state');

		expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ userId: 42 }));
		expect(login).toHaveBeenCalledWith(c, {
			email: 'admin@haitang.de',
			password: null
		}, true);
		expect(result.token).toBe('local-jwt');
	});

	it('拒绝尚未绑定的 Pocket ID 直接登录', async () => {
		const c = { env: { admin: 'admin@haitang.de' } };
		exchangeCode.mockResolvedValue({
			userId: 0,
			sub: 'pocket-user-id',
			email: 'i@521.moe',
			username: 'xiaobo'
		});
		vi.spyOn(oauthService, 'getByIdentity').mockResolvedValue({
			oauthUserId: 'pocket-user-id',
			platform: 'pocketid',
			userId: 0
		});
		selectByIdIncludeDel.mockResolvedValue(null);

		await expect(oauthService.pocketIdLogin(c, {
			code: 'code',
			state: 'state',
			redirectUri: 'https://mail.haitang.de/login'
		}, 'state')).rejects.toThrow('请先使用管理员密码绑定 Pocket ID');
	});

	it('拒绝 Pocket ID 记录登录非管理员账号', async () => {
		const c = { env: { admin: 'admin@haitang.de' } };
		exchangeCode.mockResolvedValue({
			userId: 0,
			sub: 'pocket-user-id',
			email: 'i@521.moe',
			username: 'xiaobo'
		});
		vi.spyOn(oauthService, 'getByIdentity').mockResolvedValue({
			oauthUserId: 'pocket-user-id',
			platform: 'pocketid',
			userId: 8
		});
		selectByIdIncludeDel.mockResolvedValue({ userId: 8, email: 'user@haitang.de' });

		await expect(oauthService.pocketIdLogin(c, {
			code: 'code',
			state: 'state',
			redirectUri: 'https://mail.haitang.de/login'
		}, 'state')).rejects.toThrow('Pocket ID 未绑定管理员账号');
	});
});
