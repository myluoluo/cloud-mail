import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/pocket-id-*.spec.js', 'test/email-batch-delete.spec.js', 'test/email-template.spec.js', 'test/email-detail.spec.js', 'test/oss-key-guard.spec.js', 'test/resend-webhook.spec.js', 'test/resend-webhook-api.spec.js', 'test/telegram-preview.spec.js', 'test/telegram-webhook.spec.js'],
		pool: 'forks'
	}
});
