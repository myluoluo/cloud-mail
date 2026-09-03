import { beforeEach, describe, expect, it, vi } from 'vitest';
import pocketIdService from '../src/service/pocket-id-service';

const issuer = 'https://oauth.haitang.de';
const clientId = 'cloud-mail-client';
const redirectUri = 'https://mail.haitang.de/login';

function createContext() {
	const values = new Map();
	return {
		env: {
			POCKET_ID_CLIENT_ID: clientId,
			POCKET_ID_CLIENT_SECRET: 'secret',
			POCKET_ID_ISSUER: issuer,
			kv: {
				get: vi.fn(key => values.get(key) ?? null),
				put: vi.fn((key, value) => values.set(key, value)),
				delete: vi.fn(key => values.delete(key))
			}
		},
		req: {
			url: 'https://mail.haitang.de/api/oauth/pocketId/authorize'
		}
	};
}

async function createSignedToken(claims) {
	const keys = await crypto.subtle.generateKey({
		name: 'RSASSA-PKCS1-v1_5',
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: 'SHA-256'
	}, true, ['sign', 'verify']);
	const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
	publicKey.kid = 'test-key';
	publicKey.use = 'sig';
	publicKey.alg = 'RS256';

	const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
		.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
	const payload = encode(claims);
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		keys.privateKey,
		new TextEncoder().encode(`${header}.${payload}`)
	);
	const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
		.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
	return { token: `${header}.${payload}.${encodedSignature}`, publicKey };
}

describe('Pocket ID OIDC', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('创建带 PKCE 和一次性状态的授权请求', async () => {
		const c = createContext();
		const authorization = await pocketIdService.createAuthorization(c, redirectUri, 7);
		const url = new URL(authorization.url);

		expect(url.origin).toBe(issuer);
		expect(url.pathname).toBe('/authorize');
		expect(url.searchParams.get('client_id')).toBe(clientId);
		expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('nonce')).toBeTruthy();
		expect(authorization.state).toBe(url.searchParams.get('state'));
		expect(c.env.kv.put).toHaveBeenCalledWith(
			expect.stringContaining(authorization.state),
			expect.any(String),
			{ expirationTtl: 600 }
		);
		const stored = JSON.parse(c.env.kv.put.mock.calls[0][1]);
		expect(stored).toMatchObject({ redirectUri, userId: 7 });
		expect(stored.codeVerifier).toBeTruthy();
	});

	it('缺少完整运行时配置时保持禁用', async () => {
		const c = createContext();
		delete c.env.POCKET_ID_CLIENT_SECRET;

		await expect(pocketIdService.createAuthorization(c, redirectUri)).rejects.toThrow('Pocket ID OAuth 未配置');
	});

	it('验证 Pocket ID 签名和声明后返回稳定身份', async () => {
		const c = createContext();
		const authorization = await pocketIdService.createAuthorization(c, redirectUri, 7);
		const stored = JSON.parse(c.env.kv.put.mock.calls[0][1]);
		const now = Math.floor(Date.now() / 1000);
		const { token, publicKey } = await createSignedToken({
			iss: issuer,
			aud: clientId,
			sub: 'pocket-user-id',
			exp: now + 300,
			iat: now,
			nonce: stored.nonce,
			email: 'i@521.moe',
			email_verified: true,
			preferred_username: 'xiaobo'
		});
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ id_token: token }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ keys: [publicKey] }), { status: 200 }))
		);

		const identity = await pocketIdService.exchangeCode(c, {
			code: 'authorization-code',
			state: authorization.state,
			redirectUri
		}, authorization.state);

		expect(identity).toMatchObject({
			userId: 7,
			sub: 'pocket-user-id',
			email: 'i@521.moe',
			username: 'xiaobo'
		});
		expect(c.env.kv.delete).toHaveBeenCalled();
	});

	it('拒绝未绑定到当前浏览器的回调状态', async () => {
		const c = createContext();
		const authorization = await pocketIdService.createAuthorization(c, redirectUri);

		await expect(pocketIdService.exchangeCode(c, {
			code: 'authorization-code',
			state: authorization.state,
			redirectUri
		}, 'different-browser-state')).rejects.toThrow('OAuth 状态无效');
	});
});
