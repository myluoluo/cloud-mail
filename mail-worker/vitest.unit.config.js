import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/pocket-id-*.spec.js', 'test/email-batch-delete.spec.js'],
		pool: 'forks'
	}
});
