/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency only, never shipped to npm */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SimplyPrintTrigger } from '../nodes/SimplyPrintTrigger/SimplyPrintTrigger.node';

/**
 * These tests wire a hand-rolled mock IHookFunctions context and make sure
 * the three webhook-lifecycle methods (checkExists, create, delete) behave
 * correctly against the SimplyPrint backend shape.
 */

type StaticData = { webhookId?: number; secret?: string; event?: string };

function mockContext(opts: {
	staticData?: StaticData;
	webhookUrl?: string;
	httpResponder?: (req: { method: string; url: string; body?: unknown }) => unknown;
	event?: string;
	webhookOptions?: { publicBaseUrl?: string; allowPrivateUrl?: boolean };
}) {
	const staticData: StaticData = opts.staticData ?? {};
	const httpRequestWithAuthentication = vi.fn(async (_cred: string, req: { method: string; url: string; body?: unknown }) => {
		if (opts.httpResponder) return opts.httpResponder(req);
		return { status: true, company: { id: 77 } };
	});

	const ctx = {
		getNodeWebhookUrl: vi.fn(() => opts.webhookUrl ?? 'https://n8n.test/webhook/abc'),
		getWorkflowStaticData: vi.fn(() => staticData),
		getNodeParameter: vi.fn((name: string) => {
			if (name === 'authentication') return 'apiKey';
			if (name === 'event') return opts.event ?? 'job.done';
			if (name === 'webhookOptions') return opts.webhookOptions ?? {};
			return undefined;
		}),
		getCredentials: vi.fn(async () => ({ panelUrl: 'https://simplyprint.io', companyId: 77 })),
		getNode: vi.fn(() => ({ name: 'SimplyPrint Trigger' })),
		helpers: { httpRequestWithAuthentication },
	} as unknown;

	return { ctx, staticData, httpRequestWithAuthentication };
}

describe('SimplyPrintTrigger.webhookMethods', () => {
	const node = new SimplyPrintTrigger();
	const methods = node.webhookMethods.default;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('checkExists returns false when no webhook id is cached', async () => {
		const { ctx } = mockContext({ staticData: {} });
		const exists = await methods.checkExists.call(ctx as never);
		expect(exists).toBe(false);
	});

	it('checkExists returns true when the server still reports the cached id', async () => {
		const { ctx } = mockContext({
			staticData: { webhookId: 555, secret: 's', event: 'job.done' },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Get')) {
					// SimplyPrint envelope spreads data at top level
					// (`array_merge($resp, $this->objects)` in AjaxBaseController).
					return {
						status: true,
						data: [{ id: 555, url: 'https://n8n.test/webhook/abc' }],
					};
				}
				return { status: true, company: { id: 77 } };
			},
		});
		const exists = await methods.checkExists.call(ctx as never);
		expect(exists).toBe(true);
	});

	it('checkExists clears stale state when the server no longer has the id', async () => {
		const { ctx, staticData } = mockContext({
			staticData: { webhookId: 1, secret: 's', event: 'job.done' },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Get')) {
					return { status: true, data: [] };
				}
				return { status: true, company: { id: 77 } };
			},
		});
		const exists = await methods.checkExists.call(ctx as never);
		expect(exists).toBe(false);
		expect(staticData.webhookId).toBeUndefined();
		expect(staticData.secret).toBeUndefined();
	});

	it('checkExists returns true (optimistic) when the backend call throws', async () => {
		const { ctx } = mockContext({
			staticData: { webhookId: 7 },
			httpResponder: () => {
				throw new Error('network down');
			},
		});
		// simplyprintCall wraps throws in NodeApiError, so the trigger's try/catch runs
		const exists = await methods.checkExists.call(ctx as never);
		expect(exists).toBe(true);
	});

	it('create stores the webhook id and a fresh secret on success', async () => {
		const { ctx, staticData, httpRequestWithAuthentication } = mockContext({
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Create')) {
					return { status: true, webhook: { id: 999 } };
				}
				return { status: true, company: { id: 77 } };
			},
			event: 'job.started',
		});
		const ok = await methods.create.call(ctx as never);
		expect(ok).toBe(true);
		expect(staticData.webhookId).toBe(999);
		expect(staticData.event).toBe('job.started');
		expect(staticData.secret).toMatch(/^[a-f0-9]{64}$/);

		// Verify the register payload carried the webhook url, the event, and the generated secret
		const createCall = httpRequestWithAuthentication.mock.calls.find(
			(c) => c[1].url.endsWith('/webhooks/Create'),
		);
		const body = createCall?.[1].body as Record<string, unknown>;
		expect(body.url).toBe('https://n8n.test/webhook/abc');
		expect(body.events).toEqual(['job.started']);
		expect(body.enabled).toBe(true);
		expect(typeof body.secret).toBe('string');
		expect((body.secret as string).length).toBe(64);
	});

	it('create returns false when the server does not return a webhook id', async () => {
		const { ctx, staticData } = mockContext({
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Create')) {
					return { status: true };
				}
				return { status: true, company: { id: 77 } };
			},
		});
		const ok = await methods.create.call(ctx as never);
		expect(ok).toBe(false);
		expect(staticData.webhookId).toBeUndefined();
	});

	it('delete returns true and clears state on success', async () => {
		const { ctx, staticData, httpRequestWithAuthentication } = mockContext({
			staticData: { webhookId: 123, secret: 's', event: 'job.done' },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Delete')) {
					return { status: true };
				}
				return { status: true, company: { id: 77 } };
			},
		});
		const ok = await methods.delete.call(ctx as never);
		expect(ok).toBe(true);
		expect(staticData.webhookId).toBeUndefined();
		expect(staticData.secret).toBeUndefined();

		const deleteCall = httpRequestWithAuthentication.mock.calls.find(
			(c) => c[1].url.endsWith('/webhooks/Delete'),
		);
		expect(deleteCall?.[1].body).toEqual({ id: 123 });
	});

	it('delete swallows backend errors (webhook may already be gone)', async () => {
		const { ctx, staticData } = mockContext({
			staticData: { webhookId: 123 },
			httpResponder: () => {
				throw new Error('404');
			},
		});
		const ok = await methods.delete.call(ctx as never);
		expect(ok).toBe(true);
		expect(staticData.webhookId).toBeUndefined();
	});

	it('delete is a no-op when no webhook id is cached', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({ staticData: {} });
		const ok = await methods.delete.call(ctx as never);
		expect(ok).toBe(true);
		// No Delete call should have been issued
		expect(
			httpRequestWithAuthentication.mock.calls.some((c) => c[1].url.endsWith('/webhooks/Delete')),
		).toBe(false);
	});

	it('create refuses to register a localhost URL by default', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			webhookUrl: 'http://localhost:5678/webhook/abc',
		});
		await expect(methods.create.call(ctx as never)).rejects.toThrow(/unroutable/i);
		// And it must not have called the backend
		expect(
			httpRequestWithAuthentication.mock.calls.some((c) => c[1].url.endsWith('/webhooks/Create')),
		).toBe(false);
	});

	it('create refuses RFC1918 / loopback / link-local addresses by default', async () => {
		for (const url of [
			'http://127.0.0.1:5678/webhook/abc',
			'http://10.0.0.5:5678/webhook/abc',
			'http://192.168.1.10:5678/webhook/abc',
			'http://172.20.0.1:5678/webhook/abc',
			'http://169.254.10.10:5678/webhook/abc',
			'http://[::1]:5678/webhook/abc',
			'http://n8n.local/webhook/abc',
		]) {
			const { ctx } = mockContext({ webhookUrl: url });
			await expect(methods.create.call(ctx as never)).rejects.toThrow(/unroutable/i);
		}
	});

	it('create allows a private URL when Allow Private URL is enabled', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			webhookUrl: 'http://10.0.0.5:5678/webhook/abc',
			webhookOptions: { allowPrivateUrl: true },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Create')) return { status: true, webhook: { id: 1 } };
				return { status: true, company: { id: 77 } };
			},
		});
		const ok = await methods.create.call(ctx as never);
		expect(ok).toBe(true);
		const createCall = httpRequestWithAuthentication.mock.calls.find((c) =>
			c[1].url.endsWith('/webhooks/Create'),
		);
		const body = createCall?.[1].body as Record<string, unknown>;
		expect(body.url).toBe('http://10.0.0.5:5678/webhook/abc');
	});

	it('create uses Public Base URL Override to rewrite the host', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			webhookUrl: 'http://localhost:5678/webhook/abc/webhook',
			webhookOptions: { publicBaseUrl: 'https://n8n.example.com' },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Create')) return { status: true, webhook: { id: 2 } };
				return { status: true, company: { id: 77 } };
			},
		});
		const ok = await methods.create.call(ctx as never);
		expect(ok).toBe(true);
		const createCall = httpRequestWithAuthentication.mock.calls.find((c) =>
			c[1].url.endsWith('/webhooks/Create'),
		);
		const body = createCall?.[1].body as Record<string, unknown>;
		expect(body.url).toBe('https://n8n.example.com/webhook/abc/webhook');
	});

	it('create preserves the path prefix from Public Base URL Override', async () => {
		const { ctx, httpRequestWithAuthentication } = mockContext({
			webhookUrl: 'http://localhost:5678/webhook/abc/webhook',
			webhookOptions: { publicBaseUrl: 'https://proxy.example.com/n8n/' },
			httpResponder: (req) => {
				if (req.url.endsWith('/webhooks/Create')) return { status: true, webhook: { id: 3 } };
				return { status: true, company: { id: 77 } };
			},
		});
		const ok = await methods.create.call(ctx as never);
		expect(ok).toBe(true);
		const createCall = httpRequestWithAuthentication.mock.calls.find((c) =>
			c[1].url.endsWith('/webhooks/Create'),
		);
		const body = createCall?.[1].body as Record<string, unknown>;
		expect(body.url).toBe('https://proxy.example.com/n8n/webhook/abc/webhook');
	});
});