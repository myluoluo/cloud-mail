const encoder = new TextEncoder();
// Workers 生产运行时目前限制 PBKDF2 单次最多 100000 轮。
const PASSWORD_ITERATIONS = 100000;
const HASH_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

const saltHashUtils = {

	generateSalt(length = 16) {
		const array = new Uint8Array(length);
		crypto.getRandomValues(array);
		return btoa(String.fromCharCode(...array));
	},


	async hashPassword(password) {
		const salt = this.generateSalt();
		const hash = await this.genHashPassword(password, salt);
		return { salt, hash };
	},

	async genHashPassword(password, salt) {
		const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
		const hashBuffer = await crypto.subtle.deriveBits({
			name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: PASSWORD_ITERATIONS
		}, key, 256);
		return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))}`;
	},

	async verifyPassword(inputPassword, salt, storedHash) {
		if (typeof inputPassword !== 'string' || typeof salt !== 'string' || typeof storedHash !== 'string') return false;
		let actual;
		let expected;
		const parts = storedHash.split('$');
		if (parts.length === 3 && parts[0] === 'pbkdf2-sha256' && parts[1] === String(PASSWORD_ITERATIONS) && HASH_BASE64.test(parts[2])) {
			actual = (await this.genHashPassword(inputPassword, salt)).split('$')[2];
			expected = parts[2];
		} else if (HASH_BASE64.test(storedHash)) {
			// 仅兼容旧格式；成功认证后由用户服务升级存储。
			const digest = await crypto.subtle.digest('SHA-256', encoder.encode(salt + inputPassword));
			actual = btoa(String.fromCharCode(...new Uint8Array(digest)));
			expected = storedHash;
		} else {
			return false;
		}
		let difference = 0;
		for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
		return difference === 0;
	},

	genRandomPwd(length = 16) {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		// 248 是小于 256 且可被 62 整除的最大值，丢弃其余字节消除偏差。
		while (result.length < length) {
			const bytes = crypto.getRandomValues(new Uint8Array(32));
			for (const byte of bytes) {
				if (byte < 248) result += chars[byte % chars.length];
				if (result.length === length) break;
			}
		}
		return result;
	}
};

export default saltHashUtils;
