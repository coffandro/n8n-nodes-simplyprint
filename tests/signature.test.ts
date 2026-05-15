/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect } from 'vitest';

import {
	generateWebhookSecret,
	verifySimplyprintSignature,
	extractSecretHeader,
} from '../nodes/SimplyPrint/common/signature';

describe('generateWebhookSecret', () => {
	it('returns a 64-char lowercase hex string', () => {
		expect(generateWebhookSecret()).toMatch(/^[a-f0-9]{64}$/);
	});

	it('produces distinct secrets on repeated calls', () => {
		expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
	});
});

describe('verifySimplyprintSignature', () => {
	it('accepts matching header + secret', () => {
		const s = 'a'.repeat(64);
		expect(verifySimplyprintSignature(s, s)).toBe(true);
	});

	it('rejects missing header / secret / empty strings', () => {
		expect(verifySimplyprintSignature(undefined, 'abc')).toBe(false);
		expect(verifySimplyprintSignature('abc', undefined)).toBe(false);
		expect(verifySimplyprintSignature(undefined, undefined)).toBe(false);
		expect(verifySimplyprintSignature('', 'abc')).toBe(false);
		expect(verifySimplyprintSignature('abc', '')).toBe(false);
	});

	it('rejects length mismatch (timing-safe guard)', () => {
		expect(verifySimplyprintSignature('short', 'much-longer-secret')).toBe(false);
	});

	it('rejects equal-length but different values', () => {
		expect(verifySimplyprintSignature('a'.repeat(32), 'b'.repeat(32))).toBe(false);
	});

	it('round-trips a freshly generated secret', () => {
		const s = generateWebhookSecret();
		expect(verifySimplyprintSignature(s, s)).toBe(true);
		expect(verifySimplyprintSignature(s + '!', s)).toBe(false);
	});
});

describe('extractSecretHeader', () => {
	it('reads the n8n-lowercased header first', () => {
		expect(extractSecretHeader({ 'x-sp-secret': 'abc' })).toBe('abc');
	});

	it('falls back to canonical casing', () => {
		expect(extractSecretHeader({ 'X-SP-Secret': 'def' })).toBe('def');
	});

	it('falls back to mixed casing', () => {
		expect(extractSecretHeader({ 'X-Sp-Secret': 'ghi' })).toBe('ghi');
	});

	it('prefers the lowercase variant when several casings are present', () => {
		expect(
			extractSecretHeader({ 'x-sp-secret': 'winner', 'X-SP-Secret': 'loser' }),
		).toBe('winner');
	});

	it('returns undefined when the header is absent', () => {
		expect(extractSecretHeader({})).toBeUndefined();
		expect(extractSecretHeader({ 'content-type': 'application/json' })).toBeUndefined();
	});

	it('handles array-valued headers (some proxies send them)', () => {
		expect(extractSecretHeader({ 'x-sp-secret': ['first', 'second'] })).toBe('first');
	});
});