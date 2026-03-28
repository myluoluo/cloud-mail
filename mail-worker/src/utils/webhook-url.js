const WEBHOOK_PROTOCOLS = new Set(['http:', 'https:']);

export function isHttpUrl(url) {
	try {
		return WEBHOOK_PROTOCOLS.has(new URL(url).protocol);
	} catch (error) {
		return false;
	}
}
