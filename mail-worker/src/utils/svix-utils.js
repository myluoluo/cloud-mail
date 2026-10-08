// Svix/Resend 入站 webhook 签名校验（手动验签实现，兼容 Workers 与 Node）。
// 签名方案见 https://docs.svix.com/receiving/verifying-payloads/how-manual：
// signed_content = "{svix-id}.{svix-timestamp}.{raw_body}"，HMAC-SHA256，
// 密钥为 signing secret 去掉 "whsec_" 前缀后 base64 解码。
export const SVIX_TOLERANCE_SEC = 300;

function base64ToBytes(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i);
	}
	return bytes;
}

function timingSafeEqual(a, b) {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

export async function verifySvixSignature({ secret, headers, payload, toleranceSec = SVIX_TOLERANCE_SEC, nowSec = Math.floor(Date.now() / 1000) }) {
	if (!secret || typeof payload !== 'string') {
		return false;
	}

	const id = headers?.['svix-id'] || '';
	const timestamp = headers?.['svix-timestamp'] || '';
	const signature = headers?.['svix-signature'] || '';

	if (!id || !timestamp || !signature) {
		return false;
	}

	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) {
		return false;
	}

	const keyB64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
	let keyBytes;
	try {
		keyBytes = base64ToBytes(keyB64);
	} catch {
		return false;
	}
	if (keyBytes.length === 0) {
		return false;
	}

	const signed = new TextEncoder().encode(`${id}.${timestamp}.${payload}`);
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));

	const candidates = signature.split(' ').map(item => item.trim()).filter(Boolean);
	for (const candidate of candidates) {
		const sep = candidate.indexOf(',');
		if (sep === -1 || candidate.slice(0, sep) !== 'v1') {
			continue;
		}
		let sigBytes;
		try {
			sigBytes = base64ToBytes(candidate.slice(sep + 1));
		} catch {
			continue;
		}
		if (timingSafeEqual(expected, sigBytes)) {
			return true;
		}
	}
	return false;
}
