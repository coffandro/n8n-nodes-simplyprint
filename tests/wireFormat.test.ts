/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SimplyPrint } from '../nodes/SimplyPrint/SimplyPrint.node';

/**
 * Wire-format regression tests for the 0.4.0 audit pass.
 *
 * SimplyPrint's `AjaxBaseController` keeps `$_POST` and `$_GET` strictly
 * separate. Endpoints declare which scope each field lives in, and
 * helpers like `RequirePrinter()` / `RequireFilament()` default to GET.
 * Pre-0.4.0 the n8n node was sending several fields in the wrong scope,
 * which the backend silently dropped. These tests assert the corrected
 * qs vs body split for each previously-broken action.
 */

interface MockedParams {
	resource: string;
	operation: string;
	[key: string]: unknown;
}

function mockExecuteContext(
	params: MockedParams,
	responder: (req: { url: string; method: string; body?: unknown; qs?: unknown }) => unknown,
) {
	const httpRequestWithAuthentication = vi.fn(
		async (
			_cred: string,
			req: { url: string; method: string; body?: unknown; qs?: unknown },
		) => responder(req),
	);

	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: vi.fn(
			(name: string, _i: number, fallback?: unknown, opts?: { extractValue?: boolean }) => {
				if (name === 'authentication') return 'apiKey';
				if (opts?.extractValue) {
					const raw = params[name];
					if (raw && typeof raw === 'object' && '__rl' in (raw as object)) {
						return (raw as { value: unknown }).value;
					}
					return raw ?? fallback;
				}
				return params[name] ?? fallback;
			},
		),
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

function findCall(
	mock: ReturnType<typeof vi.fn>,
	pathSuffix: string,
): { url: string; method: string; body?: unknown; qs?: unknown } | undefined {
	const call = mock.mock.calls.find((c) => (c[1] as { url: string }).url.endsWith(pathSuffix));
	return call?.[1] as { url: string; method: string; body?: unknown; qs?: unknown } | undefined;
}

describe('queue wire-format', () => {
	const node = new SimplyPrint();
	beforeEach(() => vi.clearAllMocks());

	it('queue.updateItem sends `job` in qs and `amount`/`note` in body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'updateItem',
				queueItemId: { __rl: true, mode: 'id', value: '8821' },
				amount: 3,
				note: 'tree supports',
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/UpdateItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ job: 8821 });
		expect(req?.body).toEqual({ amount: 3, note: 'tree supports' });
	});

	it('queue.moveItem sends `jobs` (CSV) and `moveTo` in qs, no body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'moveItem',
				queueItemId: { __rl: true, mode: 'id', value: '8821' },
				toPosition: 5,
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/MoveItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ jobs: '8821', moveTo: 5 });
		expect(req?.body).toBeUndefined();
	});

	it('queue.removeItem sends `job` in qs, no body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'removeItem',
				queueItemId: { __rl: true, mode: 'id', value: '8821' },
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/DeleteItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ job: 8821 });
		expect(req?.body).toBeUndefined();
	});

	it('queue.reviveItem sends `job` in qs, no body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'reviveItem',
				queueItemId: { __rl: true, mode: 'id', value: '8821' },
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/ReviveItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ job: 8821 });
		expect(req?.body).toBeUndefined();
	});

	it('queue.empty uses backend field names `group` and `done_items` in body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'queue', operation: 'empty', groupId: 4, includeDone: true },
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/EmptyQueue');
		expect(req?.method).toBe('POST');
		expect(req?.body).toEqual({ group: 4, done_items: true });
	});

	it('queue.empty omits both fields when neither is set', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'queue', operation: 'empty', groupId: 0, includeDone: false },
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/EmptyQueue');
		expect(req?.body).toEqual({});
	});

	it('queue.approveItem sends `jobs` CSV in qs, `comment` in body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'approveItem',
				queueItemIds: '11, 22, 33',
				comment: 'looks good',
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/approval/ApproveItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ jobs: '11,22,33' });
		expect(req?.body).toEqual({ comment: 'looks good' });
	});

	it('queue.denyItem defaults to remove:true (drop)', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'queue', operation: 'denyItem', queueItemIds: '99' },
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/approval/DenyItem');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ jobs: '99' });
		expect(req?.body).toEqual({ remove: true });
	});

	it('queue.denyItem with requestRevision=true sends remove:false', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'queue',
				operation: 'denyItem',
				queueItemIds: '99',
				comment: 'please reslice',
				requestRevision: true,
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/queue/approval/DenyItem');
		expect(req?.body).toEqual({ comment: 'please reslice', remove: false });
	});
});

describe('filament wire-format', () => {
	const node = new SimplyPrint();
	beforeEach(() => vi.clearAllMocks());

	it('filament.assign defaults nozzle 0 / extruder 0 and uses new-API body shape', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'filament',
				operation: 'assign',
				filamentId: { __rl: true, mode: 'id', value: '17' },
				printerId: { __rl: true, mode: 'id', value: '42' },
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/filament/Assign');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ pid: 42, fid: 17 });
		expect(req?.body).toEqual({ filament: { '17': { nozzle: 0, extruder: 0 } } });
	});

	it('filament.assign forwards user-set nozzle / extruder (multi-tool / AMS)', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'filament',
				operation: 'assign',
				filamentId: { __rl: true, mode: 'id', value: '17' },
				printerId: { __rl: true, mode: 'id', value: '42' },
				nozzle: 1,
				extruder: 3,
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/filament/Assign');
		expect(req?.body).toEqual({ filament: { '17': { nozzle: 1, extruder: 3 } } });
	});

	it('filament.unassign sends only `fid` in qs', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'filament',
				operation: 'unassign',
				filamentId: { __rl: true, mode: 'id', value: '17' },
			},
			() => ({ status: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/filament/Unassign');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ fid: 17 });
		expect(req?.body).toBeUndefined();
	});

	it('filament.get sends `id` (not `fid`) and reads response.data', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'filament',
				operation: 'get',
				filamentId: { __rl: true, mode: 'id', value: '17' },
			},
			(req) => {
				if (req.url.endsWith('/filament/GetSpecific')) {
					return { status: true, data: { id: 17, brand: 'Prusa', material: 'PLA' } };
				}
				return { status: true };
			},
		);
		const out = await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/filament/GetSpecific');
		expect(req?.method).toBe('GET');
		expect(req?.qs).toEqual({ id: 17 });
		expect((out[0][0].json as { id?: number }).id).toBe(17);
	});

	it('filament.getAll uses POST with compact:true in body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'filament', operation: 'getAll' },
			() => ({ status: true, filament: [{ id: 1, brand: 'A' }, { id: 2, brand: 'B' }] }),
		);
		const out = await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/filament/GetFilament');
		expect(req?.method).toBe('POST');
		expect(req?.body).toEqual({ compact: true });
		expect(out[0]).toHaveLength(2);
	});

	it('filament.getAll tolerates the legacy dict shape as a fallback', async () => {
		const { ctx } = mockExecuteContext({ resource: 'filament', operation: 'getAll' }, () => ({
			status: true,
			filament: { '1': { id: 1, brand: 'A' }, '2': { id: 2, brand: 'B' } },
		}));
		const out = await node.execute.call(ctx as never);
		expect(out[0]).toHaveLength(2);
	});
});

describe('printer wire-format', () => {
	const node = new SimplyPrint();
	beforeEach(() => vi.clearAllMocks());

	it('printer.getAll uses POST with page_size 100 to bypass GET cap of 25', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'printer', operation: 'getAll', simplify: false },
			() => ({ status: true, data: [] }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/printers/Get');
		expect(req?.method).toBe('POST');
		expect(req?.body).toEqual({ page: 1, page_size: 100 });
	});

	it('printer.get uses POST with `pid` in qs', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'printer',
				operation: 'get',
				simplify: false,
				printerId: { __rl: true, mode: 'id', value: '42' },
			},
			() => ({ status: true, data: { id: 42 } }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/printers/Get');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toEqual({ pid: 42 });
	});
});

describe('printJob wire-format', () => {
	const node = new SimplyPrint();
	beforeEach(() => vi.clearAllMocks());

	it('printJob.create sends `pid` (CSV) in body, not qs', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'printJob',
				operation: 'create',
				printerIds: '42, 77',
				fileSource: 'userFile',
				fileId: 'c677ebfd2de41c58eec387e3c84e7895',
				individualCustomFields: '[]',
				startOptions: '{}',
				mmsMap: '{}',
			},
			() => ({ status: true, started: true }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/printers/actions/CreateJob');
		expect(req?.method).toBe('POST');
		expect(req?.qs).toBeUndefined();
		const body = req?.body as { pid?: string; filesystem?: string };
		expect(body?.pid).toBe('42,77');
		expect(body?.filesystem).toBe('c677ebfd2de41c58eec387e3c84e7895');
	});
});

describe('organization wire-format', () => {
	const node = new SimplyPrint();
	beforeEach(() => vi.clearAllMocks());

	it('getAllPrintHistory uses POST jobs/GetPaginatedPrintJobs (the old print_history/Get path is a 404)', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'organization', operation: 'getAllPrintHistory' },
			() => ({ status: true, data: [{ id: 1 }] }),
		);
		await node.execute.call(ctx as never);
		const oldPath = findCall(httpRequestWithAuthentication, '/print_history/Get');
		const newPath = findCall(httpRequestWithAuthentication, '/jobs/GetPaginatedPrintJobs');
		expect(oldPath).toBeUndefined();
		expect(newPath?.method).toBe('POST');
		expect(newPath?.body).toEqual({ page: 1 });
	});

	it('getStatistics uses POST with general:true in body', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'organization', operation: 'getStatistics' },
			() => ({ status: true, statistics: { prints: 100 } }),
		);
		const out = await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/account/GetStatistics');
		expect(req?.method).toBe('POST');
		expect(req?.body).toEqual({ general: true });
		expect((out[0][0].json as { prints?: number }).prints).toBe(100);
	});

	it('getStatistics with startDate + endDate uses the date-range shape (not general)', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{
				resource: 'organization',
				operation: 'getStatistics',
				startDate: '1714521600',
				endDate: '1717113600',
			},
			() => ({ status: true, statistics: {} }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/account/GetStatistics');
		expect(req?.body).toEqual({ start_date: '1714521600', end_date: '1717113600' });
	});

	it('getStatistics falls back to general when only one date is set', async () => {
		const { ctx, httpRequestWithAuthentication } = mockExecuteContext(
			{ resource: 'organization', operation: 'getStatistics', startDate: '1714521600' },
			() => ({ status: true, statistics: {} }),
		);
		await node.execute.call(ctx as never);
		const req = findCall(httpRequestWithAuthentication, '/account/GetStatistics');
		expect(req?.body).toEqual({ general: true });
	});
});