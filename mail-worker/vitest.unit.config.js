import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/pocket-id-*.spec.js'],
		pool: 'forks'
	}
});
