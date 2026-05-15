/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect } from 'vitest';

import { toSubmissionArray } from '../nodes/SimplyPrint/common/customFields';

// Helper to build the fixedCollection shape n8n passes to execute():
// { value: [{customFieldId, type, value}, ...] }
const fc = (rows: Array<{ customFieldId?: unknown; type?: unknown; value?: unknown }>) => ({
	value: rows,
});

describe('toSubmissionArray', () => {
	it('returns [] for null / undefined / wrong shape', () => {
		expect(toSubmissionArray(undefined)).toEqual([]);
		expect(toSubmissionArray(null as unknown as undefined)).toEqual([]);
		expect(toSubmissionArray({})).toEqual([]);
		expect(toSubmissionArray({ value: 'not an array' as unknown } as never)).toEqual([]);
	});

	it('drops entries with no customFieldId', () => {
		expect(toSubmissionArray(fc([{ type: 'text', value: 'hello' }]))).toEqual([]);
		expect(toSubmissionArray(fc([{ customFieldId: '', type: 'text', value: 'x' }]))).toEqual([]);
		expect(toSubmissionArray(fc([{ customFieldId: '   ', type: 'text', value: 'x' }]))).toEqual([]);
	});

	it('trims whitespace off customFieldId', () => {
		expect(toSubmissionArray(fc([{ customFieldId: '  project  ', type: 'text', value: 'x' }]))).toEqual([
			{ customFieldId: 'project', value: { string: 'x' } },
		]);
	});

	it('defaults to text type when type is missing or not a string', () => {
		expect(toSubmissionArray(fc([{ customFieldId: 'a', value: 'hello' }]))).toEqual([
			{ customFieldId: 'a', value: { string: 'hello' } },
		]);
		expect(
			toSubmissionArray(fc([{ customFieldId: 'a', type: 42 as unknown, value: 'hello' }])),
		).toEqual([{ customFieldId: 'a', value: { string: 'hello' } }]);
	});

	it('coerces text rows to { string }', () => {
		expect(toSubmissionArray(fc([{ customFieldId: 'note', type: 'text', value: 'PETG' }]))).toEqual([
			{ customFieldId: 'note', value: { string: 'PETG' } },
		]);
		// undefined / null values become empty string.
		expect(toSubmissionArray(fc([{ customFieldId: 'note', type: 'text' }]))).toEqual([
			{ customFieldId: 'note', value: { string: '' } },
		]);
	});

	it('coerces number rows to { number } and drops rows with non-numeric values', () => {
		expect(toSubmissionArray(fc([{ customFieldId: 'temp', type: 'number', value: '215' }]))).toEqual([
			{ customFieldId: 'temp', value: { number: 215 } },
		]);
		expect(toSubmissionArray(fc([{ customFieldId: 'temp', type: 'number', value: '-4.5' }]))).toEqual([
			{ customFieldId: 'temp', value: { number: -4.5 } },
		]);
		// Non-numeric string → dropped.
		expect(toSubmissionArray(fc([{ customFieldId: 'temp', type: 'number', value: 'not a number' }]))).toEqual([]);
	});

	it('coerces boolean rows (truthy tokens: true, 1, yes, on)', () => {
		for (const truthy of ['true', 'TRUE', '  true  ', '1', 'yes', 'YES', 'on', 'On']) {
			expect(
				toSubmissionArray(fc([{ customFieldId: 'on', type: 'boolean', value: truthy }])),
			).toEqual([{ customFieldId: 'on', value: { boolean: true } }]);
		}
		for (const falsy of ['false', 'FALSE', '0', 'no', 'off', 'random', '']) {
			expect(
				toSubmissionArray(fc([{ customFieldId: 'on', type: 'boolean', value: falsy }])),
			).toEqual([{ customFieldId: 'on', value: { boolean: false } }]);
		}
	});

	it('passes date strings through to { date } verbatim', () => {
		expect(
			toSubmissionArray(fc([{ customFieldId: 'deadline', type: 'date', value: '2026-05-01' }])),
		).toEqual([{ customFieldId: 'deadline', value: { date: '2026-05-01' } }]);
	});

	it('parses JSON arrays into { options } with stringified entries', () => {
		expect(
			toSubmissionArray(fc([{ customFieldId: 'tags', type: 'json', value: '["red","blue",7]' }])),
		).toEqual([{ customFieldId: 'tags', value: { options: ['red', 'blue', '7'] } }]);
	});

	it('parses JSON objects into { value: ... } as-is (passthrough to backend shape)', () => {
		expect(
			toSubmissionArray(
				fc([{ customFieldId: 'raw', type: 'json', value: '{"string":"hello"}' }]),
			),
		).toEqual([{ customFieldId: 'raw', value: { string: 'hello' } }]);
	});

	it('drops JSON rows where the payload is not an object or array', () => {
		expect(
			toSubmissionArray(fc([{ customFieldId: 'raw', type: 'json', value: '42' }])),
		).toEqual([]);
		expect(
			toSubmissionArray(fc([{ customFieldId: 'raw', type: 'json', value: 'not-json' }])),
		).toEqual([]);
	});

	it('preserves row order with mixed types', () => {
		const result = toSubmissionArray(
			fc([
				{ customFieldId: 'a', type: 'text', value: 'x' },
				{ customFieldId: 'b', type: 'number', value: '2' },
				{ customFieldId: 'c', type: 'boolean', value: 'true' },
			]),
		);
		expect(result.map((r) => r.customFieldId)).toEqual(['a', 'b', 'c']);
	});

	it('accepts UUID-style custom field IDs', () => {
		const id = '7d4e6f0a-9c3b-4b2a-8e1d-3c5a2b1f0d9e';
		expect(
			toSubmissionArray(fc([{ customFieldId: id, type: 'text', value: 'PETG' }])),
		).toEqual([{ customFieldId: id, value: { string: 'PETG' } }]);
	});
});