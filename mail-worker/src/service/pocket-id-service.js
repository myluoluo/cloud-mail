import BizError from '../error/biz-error';

const STATE_PREFIX = 'oauth:pocket-id:state:';
const STATE_TTL = 600;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes) {
	return btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function decodeBase64Url(value) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
	return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function randomValue(size = 32) {
	const bytes = new Uint8Array(size);
	crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

function getConfig(c) {
	if (!c.env.POCKET_ID_CLIENT_ID || !c.env.POCKET_ID_CLIENT_SECRET || !c.env.POCKET_ID_ISSUER) {
		throw new BizError('Pocket ID OAuth 未配置');
	}
	let issuer;
	try {
		const url = new URL(c.env.POCKET_ID_ISSUER);
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
			throw new Error();
		}
		issuer = url.origin;
	} catch {
		throw new BizError('Pocket ID Issuer 配置无效');
	}
	return {
		issuer,
		clientId: c.env.POCKET_ID_CLIENT_ID,
		clientSecret: c.env.POCKET_ID_CLIENT_SECRET
	};
}

function assertRedirectUri(c, redirectUri) {
	let redirect;
	try {
		redirect = new URL(redirectUri);
	} catch {
		throw new BizError('OAuth 回调地址无效');
	}
	const requestUrl = new URL(c.req.url);
	if (redirect.origin !== requestUrl.origin || redirect.pathname !== '/login' || redirect.search || redirect.hash) {
		throw new BizError('OAuth 回调地址无效');
	}
}

async function verifyIdToken(config, idToken, nonce) {
	const parts = idToken?.split('.');
	if (parts?.length !== 3) {
		throw new BizError('Pocket ID 返回了无效的 ID Token');
	}

	let header;
	let claims;
	try {
		header = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
		claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
	} catch {
		throw new BizError('Pocket ID 返回了无效的 ID Token');
	}

	if (header.alg !== 'RS256' || !header.kid) {
		throw new BizError('Pocket ID ID Token 签名算法无效');
	}

	const jwksResponse = await fetch(`${config.issuer}/.well-known/jwks.json`);
	if (!jwksResponse.ok) {
		throw new BizError('无法读取 Pocket ID 签名密钥');
	}
	const jwks = await jwksResponse.json();
	const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA');
	if (!jwk) {
		throw new BizError('Pocket ID 签名密钥不存在');
	}

	let validSignature = false;
	try {
		const key = await crypto.subtle.importKey(
			'jwk',
			jwk,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['verify']
		);
		validSignature = await crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			key,
			decodeBase64Url(parts[2]),
			encoder.encode(`${parts[0]}.${parts[1]}`)
		);
	} catch {
		throw new BizError('Pocket ID ID Token 签名无效');
	}
	if (!validSignature) {
		throw new BizError('Pocket ID ID Token 签名无效');
	}

	const now = Math.floor(Date.now() / 1000);
	const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (claims.iss !== config.issuer || !audiences.includes(config.clientId)) {
		throw new BizError('Pocket ID ID Token 签发对象无效');
	}
	if (!claims.exp || claims.exp < now - 60 || claims.iat > now + 60 || claims.nonce !== nonce) {
		throw new BizError('Pocket ID ID Token 声明无效');
	}
	if (!claims.sub || claims.email_verified !== true) {
		throw new BizError('Pocket ID 账号缺少已验证邮箱');
	}
	return claims;
}

const pocketIdService = {
	async createAuthorization(c, redirectUri, userId = 0) {
		const config = getConfig(c);
		assertRedirectUri(c, redirectUri);

		const state = randomValue();
		const nonce = randomValue();
		const codeVerifier = randomValue(48);
		const challenge = base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier)));
		await c.env.kv.put(
			STATE_PREFIX + state,
			JSON.stringify({ nonce, codeVerifier, redirectUri, userId }),
			{ expirationTtl: STATE_TTL }
		);

		const url = new URL(`${config.issuer}/authorize`);
		url.searchParams.set('client_id', config.clientId);
		url.searchParams.set('redirect_uri', redirectUri);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('scope', 'openid profile email');
		url.searchParams.set('state', state);
		url.searchParams.set('nonce', nonce);
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');
		return { url: url.toString(), state };
	},

	async exchangeCode(c, params, browserState) {
		const config = getConfig(c);
		const { code, state, redirectUri } = params;
		if (!code || !state || state !== browserState) {
			throw new BizError('OAuth 状态无效');
		}

		const stateKey = STATE_PREFIX + state;
		const storedValue = await c.env.kv.get(stateKey);
		if (!storedValue) {
			throw new BizError('OAuth 状态已失效');
		}
		await c.env.kv.delete(stateKey);
		const stored = JSON.parse(storedValue);
		assertRedirectUri(c, redirectUri);
		if (stored.redirectUri !== redirectUri) {
			throw new BizError('OAuth 回调地址无效');
		}

		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code,
			redirect_uri: redirectUri,
			code_verifier: stored.codeVerifier
		});
		const tokenResponse = await fetch(`${config.issuer}/api/oidc/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});
		if (!tokenResponse.ok) {
			throw new BizError('Pocket ID 授权码交换失败');
		}
		const token = await tokenResponse.json();
		const claims = await verifyIdToken(config, token.id_token, stored.nonce);
		return {
			userId: stored.userId,
			sub: claims.sub,
			email: claims.email,
			username: claims.preferred_username || claims.email,
			name: claims.name,
			avatar: claims.picture
		};
	}
};

export default pocketIdService;
