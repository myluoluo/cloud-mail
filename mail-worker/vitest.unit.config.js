import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: [
			'test/error-response.spec.js',
			'test/invite-concurrency.spec.js',
			'test/public-user-sql.spec.js',
			'test/password-security.spec.js', 'test/public-token-security.spec.js', 'test/session-revocation.spec.js', 'test/user-list-security.spec.js', 'test/oauth-binding.spec.js', 'test/oauth-platform.spec.js', 'test/registration-security.spec.js', 'test/login-turnstile.spec.js', 'test/pocket-id-*.spec.js', 'test/email-batch-delete.spec.js', 'test/email-template.spec.js', 'test/email-detail.spec.js', 'test/oss-key-guard.spec.js', 'test/resend-webhook.spec.js', 'test/resend-webhook-api.spec.js', 'test/telegram-preview.spec.js', 'test/resource-proxy.spec.js'],
		pool: 'forks'
	}
});
