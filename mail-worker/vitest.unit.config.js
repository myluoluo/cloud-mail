import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/pocket-id-*.spec.js', 'test/email-batch-delete.spec.js', 'test/email-template.spec.js'],
		pool: 'forks'
	}
});
