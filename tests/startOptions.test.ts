/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect } from 'vitest';

import { normalizeStartOptions } from '../nodes/SimplyPrint/common/startOptions';

describe('normalizeStartOptions', () => {
	it('returns undefined for empty / nullish / empty string input', () => {
		expect(normalizeStartOptions(undefined)).toBeUndefined();
		expect(normalizeStartOptions('' as unknown as undefined)).toBeUndefined();
	});

	it('returns undefined when parsed object is empty', () => {
		expect(normalizeStartOptions({})).toBeUndefined();
		expect(normalizeStartOptions('{}')).toBeUndefined();
	});

	it('serialises a populated object to a JSON string', () => {
		expect(normalizeStartOptions({ nozzle: '0.4' })).toBe('{"nozzle":"0.4"}');
	});

	it('parses a JSON string input and re-stringifies it (idempotent normalization)', () => {
		expect(normalizeStartOptions('{"nozzle":"0.4","filament_material":"PLA"}')).toBe(
			'{"nozzle":"0.4","filament_material":"PLA"}',
		);
	});

	it('returns undefined on invalid JSON (silently — caller just omits the field)', () => {
		expect(normalizeStartOptions('not-valid-json')).toBeUndefined();
		expect(normalizeStartOptions('{ broken')).toBeUndefined();
	});

	it('rejects JSON arrays (start_options must be an object)', () => {
		expect(normalizeStartOptions('[1,2,3]')).toBeUndefined();
	});

	it('rejects JSON scalars (start_options must be an object)', () => {
		expect(normalizeStartOptions('42')).toBeUndefined();
		expect(normalizeStartOptions('"hello"')).toBeUndefined();
		expect(normalizeStartOptions('null')).toBeUndefined();
	});

	it('preserves nested structures when object has real keys', () => {
		const out = normalizeStartOptions({ filament: { material: 'PETG', temperature: 240 } });
		expect(out).toBe('{"filament":{"material":"PETG","temperature":240}}');
	});
});