/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect } from 'vitest';

import {
	applySimplify,
	simplifyPrinter,
	simplifyQueueItem,
	simplifyQueueGroup,
	simplifyPrintHistory,
	simplifyTag,
	userDisplayName,
} from '../nodes/SimplyPrint/common/simplify';

describe('simplifyPrinter', () => {
	it('reads name/state/group/model from the nested .printer object', () => {
		// `printers/Get` row: `{ id, sort_order, printer: {...}, filament, job }`.
		const raw = {
			id: 42,
			sort_order: 3,
			printer: {
				name: 'Voron 2.4',
				state: 'printing',
				group: 7,
				groupName: 'Fleet A',
				online: true,
				model: { id: 11, name: 'Voron 2.4 300', brand: 'Voron' },
				serial: 'aa:bb:cc:dd:ee:ff',
			},
			filament: { id: 3, brand: 'Prusament' },
			job: { progress: 42.5, filename: 'bracket.gcode', time_left: 1800 },
		};
		const out = simplifyPrinter(raw);
		expect(out.id).toBe(42);
		expect(out.name).toBe('Voron 2.4');
		expect(out.state).toBe('printing');
		expect(out.group).toBe(7);
		expect(out.groupName).toBe('Fleet A');
		expect(out.online).toBe(true);
		expect(out.model).toBe('Voron 2.4 300'); // flattened from {id,name,brand}
		expect(out.currentFile).toBe('bracket.gcode');
		expect(out.progress).toBe(42.5);
		expect(out.timeLeft).toBe(1800);
		expect(out.filament).toEqual({ id: 3, brand: 'Prusament' });
		expect(Object.keys(out).length).toBeLessThanOrEqual(11);
	});

	it('tolerates missing printer / job subobjects', () => {
		const out = simplifyPrinter({ id: 3 });
		expect(out.id).toBe(3);
		expect(out.name).toBeUndefined();
		expect(out.currentFile).toBeNull();
		expect(out.progress).toBeNull();
	});
});

describe('simplifyQueueItem', () => {
	it('picks the canonical queue-item fields (filename / group / sort_order)', () => {
		// Canonical names per PrintQueueItem::getFormattedData().
		const raw = {
			id: 8821,
			filename: 'spool.gcode',
			filesystem_id: 'c677ebfd2de41c58eec387e3c84e7895',
			group: 4,
			sort_order: 7,
			amount: 2,
			left: 1,
			printed: 0,
			user_id: 1,
			added: '2026-04-24T09:00:00Z',
			debug: 'should not leak',
			note: 'also should drop',
		};
		const out = simplifyQueueItem(raw);
		expect(out).toEqual({
			id: 8821,
			filename: 'spool.gcode',
			filesystem_id: 'c677ebfd2de41c58eec387e3c84e7895',
			group: 4,
			sort_order: 7,
			amount: 2,
			left: 1,
			printed: 0,
			user_id: 1,
			added: '2026-04-24T09:00:00Z',
		});
		expect('debug' in out).toBe(false);
		expect('note' in out).toBe(false);
	});

	it('omits undefined fields cleanly', () => {
		const out = simplifyQueueItem({ id: 1, filename: 'x' });
		expect('amount' in out).toBe(false);
		expect('debug' in out).toBe(false);
	});
});

describe('userDisplayName', () => {
	it('concatenates first_name + last_name (no combined name field on SP users)', () => {
		expect(userDisplayName({ first_name: 'Albert', last_name: 'Møller Nielsen' }))
			.toBe('Albert Møller Nielsen');
	});

	it('returns only first_name when last is missing', () => {
		expect(userDisplayName({ first_name: 'Albert' })).toBe('Albert');
	});

	it('returns undefined when user is null/empty', () => {
		expect(userDisplayName(null)).toBeUndefined();
		expect(userDisplayName(undefined)).toBeUndefined();
		expect(userDisplayName({})).toBeUndefined();
	});
});

describe('applySimplify', () => {
	it('passes through when simplify is false', () => {
		const raw = { id: 1, name: 'x', slicer: 'y' };
		expect(applySimplify(raw, false, simplifyTag)).toBe(raw);
	});

	it('maps each element when given an array', () => {
		const raw = [
			{ id: 1, name: 'red', color: '#f00', extra: 'a' },
			{ id: 2, name: 'blue', color: '#00f', extra: 'b' },
		];
		const out = applySimplify(raw, true, simplifyTag) as Array<{ extra?: string }>;
		expect(Array.isArray(out)).toBe(true);
		expect(out).toHaveLength(2);
		for (const row of out) {
			expect('extra' in row).toBe(false);
		}
	});

	it('simplifies history rows consistently', () => {
		const out = simplifyPrintHistory({
			id: 11,
			filename: 'part.gcode',
			printer_id: 3,
			started_at: 't0',
			ended_at: 't1',
			duration: 3600,
			status: 'done',
			filament_used: 12.3,
			user_id: 4,
			group_id: 1,
			ignored: 'drop me',
		});
		expect('ignored' in out).toBe(false);
		expect(Object.keys(out).length).toBeLessThanOrEqual(10);
	});

	it('keeps queue-group shape minimal', () => {
		const out = simplifyQueueGroup({
			id: 1,
			name: 'Fleet A',
			description: 'all voron printers',
			default: true,
			items_count: 4,
			printer_ids: [1, 2, 3],
			extra: 'drop',
		});
		expect('extra' in out).toBe(false);
		expect(out.printer_ids).toEqual([1, 2, 3]);
	});
});