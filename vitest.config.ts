import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['**/*.test.ts'],
		// n8n-workflow ships sourcemaps whose sources are not published, which floods
		// the run with warnings that have nothing to do with this package.
		sourcemap: false,
	},
});
