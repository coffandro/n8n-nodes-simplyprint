/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { defineConfig } from 'vitest/config';

// Unit tests cover framework-free pure helpers under nodes/SimplyPrint/common/.
// They use type-only imports from n8n-workflow, which esbuild strips at
// test time — so the suite runs without loading n8n's runtime.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		globals: false,
	},
});