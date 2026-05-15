/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SimplyPrint } from '../nodes/SimplyPrint/SimplyPrint.node';

/**
 * End-to-end tests for the action node's execute() method with a mocked
 * IExecuteFunctions context. Covers:
 *   - Printer > Get (resourceLocator id resolution + simplify + nested .printer)
 *   - Printer > Get Many (simplify off, full passthrough)
 *   - File > Move (GET files/MoveFiles with `files` CSV + `folder`)
 *   - error path surfacing vs. continueOnFail
 */

interface MockedParams {
	resource: string;
	operation: string;
	// Every other parameter the node reads, keyed by name.
	[key: string]: unknown;
}

function mockExecuteContext(params: MockedParams, responder: (req: { url: string; body?: unknown; qs?: unknown }) => unknown) {
	const httpRequestWithAuthentication = vi.fn(async (_cred: string, req: { url: string; body?: unknown; qs?: unknown }) =>
		responder(req),
	);

	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: vi.fn((name: string, _i: number, fallback?: unknown, opts?: { extractValue?: boolean }) => {
			if (name === 'authentication') return 'apiKey';
			if (opts?.extractValue) {
				const raw = params[name];
				if (raw && typeof raw === 'object' && '__rl' in (raw as object)) {
					return (raw as { value: unknown }).value;
				}
				return raw ?? fallback;
			}
			return params[name] ?? fallback;
		}),
		getCredentials: vi.fn(async () => ({ panelUrl: 'https://simplyprint.io', companyId: 77 })),
		getNode: vi.fn(() => ({ name: 'SimplyPrint' })),
		continueOnFail: vi.fn(() => false),
		helpers: {
			httpRequestWithAuthentication,
			assertBinaryData: vi.fn(),
			getBinaryDataBuffer: vi.fn(),
		},
	} as unknown;

	return { ctx, httpRequestWithAuthentication };
}

describe('SimplyPrint.execute > printer', () => {
	const node = new SimplyPrint();

	beforeEach(() => vi.clearAllMocks());

	it('printer.get with simplify=true returns the simplified shape', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'printer',
				operation: 'get',
				simplify: true,
				printerId: { __rl: true, mode: 'id', value: '42' },
			},
			(req) => {
				if (req.url.endsWith('/printers/Get')) {
					// Single-printer GET. Canonical row shape from `printers/Get`:
					// the printer's own name/state/group/model live UNDER `.printer`,
					// and the top level carries id/sort_order/filament/job.
					return {
						status: true,
						data: {
							id: 42,
							sort_order: 3,
							printer: {
								name: 'Voron 2.4',
								state: 'printing',
								group: 7,
								online: true,
								model: { id: 11, name: 'Voron 2.4 300', brand: 'Voron' },
								serial: 'aa:bb:cc:dd:ee:ff',
							},
							job: { progress: 73.2, filename: 'bracket.gcode', time_left: 900 },
							ignored_field: 'noise',
						},
					};
				}
				return { status: true };
			},
		);
		const out = await node.execute.call(ctx as never);
		expect(Array.isArray(out)).toBe(true);
		expect(out[0]).toHaveLength(1);
		const json = out[0][0].json as Record<string, unknown>;
		expect(json.id).toBe(42);
		expect(json.progress).toBe(73.2);
		expect(json.currentFile).toBe('bracket.gcode');
		expect('mac' in json).toBe(false);
		expect('ignored_field' in json).toBe(false);

		// Make sure pid was passed as an actual numeric query param.
		const printersCall = httpRequestWithAuthentication.mock.calls.find((c) =>
			c[1].url.endsWith('/printers/Get'),
		);
		expect(printersCall?.[1].qs).toEqual({ pid: 42 });
	});

	it('printer.getAll with simplify=false returns raw rows', async () => {
		const { ctx } = mockExecuteContext(
			{ resource: 'printer', operation: 'getAll', simplify: false },
			() => ({
				status: true,
				data: [
					{ id: 1, name: 'A', internal: true, debug: 'x' },
					{ id: 2, name: 'B', internal: false, debug: 'y' },
				],
			}),
		);
		const out = await node.execute.call(ctx as never);
		expect(out[0]).toHaveLength(2);
		const first = out[0][0].json as Record<string, unknown>;
		expect(first.internal).toBe(true);
		expect(first.debug).toBe('x');
	});
});

describe('SimplyPrint.execute > file.move', () => {
	const node = new SimplyPrint();

	it('issues a GET to files/MoveFiles with `files` CSV + `folder`', async () => {
		// files/MoveFiles is intentionally a GET, not a POST; the file
		// identifier on the wire is the hex `uid` string, not an integer.
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'file',
				operation: 'move',
				fileUids: 'c677ebfd2de41c58eec387e3c84e7895,96b2fc6c4aaedfbe37e62b2faafb2bf6',
				targetFolderId: 31,
			},
			() => ({ status: true, moved: 2 }),
		);
		const out = await node.execute.call(ctx as never);
		expect(out[0][0].json).toEqual({ status: true, moved: 2 });

		const call = httpRequestWithAuthentication.mock.calls.find((c) =>
			c[1].url.endsWith('/files/MoveFiles'),
		);
		expect(call?.[1].method).toBe('GET');
		expect(call?.[1].qs).toEqual({
			files: 'c677ebfd2de41c58eec387e3c84e7895,96b2fc6c4aaedfbe37e62b2faafb2bf6',
			folder: 31,
		});
	});
});

describe('SimplyPrint.execute > error path', () => {
	const node = new SimplyPrint();

	it('surfaces backend status=false as a NodeApiError', async () => {
		const { ctx } = mockExecuteContext(
			{ resource: 'printer', operation: 'getAll', simplify: true },
			() => ({ status: false, message: 'bad credential' }),
		);
		await expect(node.execute.call(ctx as never)).rejects.toThrow(/bad credential/);
	});

	it('continues on fail when the context opts in', async () => {
		const { ctx } = mockExecuteContext(
			{ resource: 'printer', operation: 'getAll', simplify: true },
			() => ({ status: false, message: 'bad credential' }),
		);
		(ctx as { continueOnFail: () => boolean }).continueOnFail = () => true;
		const out = await node.execute.call(ctx as never);
		expect(out[0][0].json).toMatchObject({ error: expect.stringContaining('bad credential') });
	});
});