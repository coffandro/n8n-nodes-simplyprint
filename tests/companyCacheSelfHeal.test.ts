/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { simplyprintCall } from '../nodes/SimplyPrint/common/client';

/**
 * `resolveOAuthCompany` caches the OAuth2 token's bound company id in workflow
 * static data, keyed by panelUrl. After reauth (or admin-side org rebinding)
 * the cache can outlive its truth, which made SP reject every subsequent call
 * with "OAuth2 token is not valid for this company". The client now detects
 * that exact error, drops the cache entry, re-resolves via `account/GetUser`,
 * and retries the original request once.
 */

interface Req {
	method: string;
	url: string;
	body?: unknown;
	qs?: unknown;
}

function buildOAuthCtx(opts: {
	staticData?: Record<string, unknown>;
	httpResponder: (cred: string, req: Req) => unknown;
}) {
	const staticData: Record<string, unknown> = opts.staticData ?? {};
	const httpRequestWithAuthentication = vi.fn(async (cred: string, req: Req) =>
		opts.httpResponder(cred, req),
	);

	const ctx = {
		getNodeParameter: vi.fn((name: string, _i?: unknown, fallback?: unknown) => {
			if (name === 'authentication') return 'oAuth2';
			return fallback;
		}),
		getCredentials: vi.fn(async (type: string) => {
			if (type === 'simplyPrintOAuth2Api') return { panelUrl: 'https://simplyprint.io' };
			return {};
		}),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNode: vi.fn(() => ({ name: 'SimplyPrint' })),
		helpers: { httpRequestWithAuthentication },
	} as unknown;

	return { ctx, staticData, httpRequestWithAuthentication };
}

describe('simplyprintCall OAuth company self-heal', () => {
	beforeEach(() => vi.clearAllMocks());

	it('invalidates stale cached company id and retries when SP returns "not valid for this company"', async () => {
		const calls: Req[] = [];
		// staticData starts populated with the WRONG company (this is the
		// post-reauth state that was bricking the user).
		const staticData = { 'simplyPrintCompany:https://simplyprint.io': 100 };

		const { ctx, httpRequestWithAuthentication } = buildOAuthCtx({
			staticData,
			httpResponder: (_cred, req) => {
				calls.push(req);
				if (req.url.endsWith('/api/0/account/GetUser')) {
					// Re-resolution returns the NEW company id (200).
					return { status: true, user: { id: 1 }, company: { id: 200 } };
				}
				if (req.url.includes('/api/100/')) {
					// The first call uses the stale cached 100 and is rejected.
					return { status: false, message: 'OAuth2 token is not valid for this company' };
				}
				if (req.url.includes('/api/200/')) {
					// The retry under the freshly-resolved 200 succeeds.
					return { status: true, data: { ok: true } };
				}
				return { status: false, message: 'unexpected url ' + req.url };
			},
		});

		const res = await simplyprintCall(ctx as never, {
			method: 'POST',
			path: 'printers/actions/Cancel',
			qs: { pid: 5 },
		});

		expect((res as { data?: { ok?: boolean } }).data?.ok).toBe(true);
		// Cache now reflects the new company.
		expect(staticData['simplyPrintCompany:https://simplyprint.io']).toBe(200);

		// We should have made exactly three calls: the failing /api/100/... ,
		// the /api/0/account/GetUser re-resolve, and the retry under /api/200/...
		expect(httpRequestWithAuthentication.mock.calls.length).toBe(3);
		expect(calls[0].url).toContain('/api/100/printers/actions/Cancel');
		expect(calls[1].url).toContain('/api/0/account/GetUser');
		expect(calls[2].url).toContain('/api/200/printers/actions/Cancel');
	});

	it('also self-heals when the error is thrown by httpRequestWithAuthentication instead of returned as status:false', async () => {
		const staticData = { 'simplyPrintCompany:https://simplyprint.io': 100 };
		const { ctx, httpRequestWithAuthentication } = buildOAuthCtx({
			staticData,
			httpResponder: (_cred, req) => {
				if (req.url.endsWith('/api/0/account/GetUser')) {
					return { status: true, user: { id: 1 }, company: { id: 200 } };
				}
				if (req.url.includes('/api/100/')) {
					// Mimic n8n's httpRequestWithAuthentication throwing on 403.
					const err = new Error('Forbidden - OAuth2 token is not valid for this company');
					(err as Error & { httpCode?: number }).httpCode = 403;
					throw err;
				}
				if (req.url.includes('/api/200/')) {
					return { status: true, data: { ok: true } };
				}
				return { status: false };
			},
		});

		const res = await simplyprintCall(ctx as never, {
			method: 'POST',
			path: 'printers/actions/Cancel',
			qs: { pid: 5 },
		});
		expect((res as { data?: { ok?: boolean } }).data?.ok).toBe(true);
		expect(staticData['simplyPrintCompany:https://simplyprint.io']).toBe(200);
		expect(httpRequestWithAuthentication.mock.calls.length).toBe(3);
	});

	it('does not retry forever - a second mismatch surfaces the error', async () => {
		// If the resolved company STILL doesn't match (e.g. broken backend), we
		// must not loop. Surface the failure on the second try.
		const staticData = { 'simplyPrintCompany:https://simplyprint.io': 100 };
		const { ctx, httpRequestWithAuthentication } = buildOAuthCtx({
			staticData,
			httpResponder: (_cred, req) => {
				if (req.url.endsWith('/api/0/account/GetUser')) {
					return { status: true, user: { id: 1 }, company: { id: 200 } };
				}
				return { status: false, message: 'OAuth2 token is not valid for this company' };
			},
		});

		await expect(
			simplyprintCall(ctx as never, { method: 'POST', path: 'printers/actions/Cancel' }),
		).rejects.toThrow(/not valid for this company/i);
		// 3 calls total: original 100/Cancel, GetUser, retry 200/Cancel. No 4th.
		expect(httpRequestWithAuthentication.mock.calls.length).toBe(3);
	});

	it('does not self-heal when the caller passed an explicit `company` (e.g. company: 0)', async () => {
		const staticData = { 'simplyPrintCompany:https://simplyprint.io': 100 };
		const { ctx, httpRequestWithAuthentication } = buildOAuthCtx({
			staticData,
			httpResponder: () => ({
				status: false,
				message: 'OAuth2 token is not valid for this company',
			}),
		});

		await expect(
			simplyprintCall(ctx as never, { method: 'GET', path: 'account/GetUser', company: 0 }),
		).rejects.toThrow(/not valid for this company/i);
		// No re-resolution, no retry: the user picked the company deliberately.
		expect(httpRequestWithAuthentication.mock.calls.length).toBe(1);
		// Cache untouched.
		expect(staticData['simplyPrintCompany:https://simplyprint.io']).toBe(100);
	});
});
