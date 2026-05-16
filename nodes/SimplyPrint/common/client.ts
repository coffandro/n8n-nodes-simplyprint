import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	ITriggerFunctions,
	IWebhookFunctions,
	IDataObject,
	IHttpRequestMethods,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import type { SimplyprintResponse } from './types';

export type SimplyprintContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| ITriggerFunctions
	| IWebhookFunctions;

export interface SimplyprintCallOptions {
	method: IHttpRequestMethods;
	path: string;
	body?: IDataObject | Buffer;
	qs?: IDataObject;
	/**
	 * Override the URL-path company segment. When omitted, the endpoint is
	 * scoped to the credential's company (OAuth: resolved + cached in static
	 * data; API key: supplied by the user on the credential). Pass `0`
	 * explicitly for endpoints that don't require a company (e.g. GetUser).
	 */
	company?: number;
	/**
	 * For multipart uploads - if set, overrides the default JSON body handling.
	 */
	formData?: IDataObject;
	/**
	 * Override the host URL (e.g. for files.simplyprint.io uploads, which are
	 * served by a separate domain). When set, the request URL is built as
	 * `${baseUrlOverride}/${companyId}/${path}` instead of using the
	 * credential's panelUrl + `/api`.
	 */
	baseUrlOverride?: string;
}

type AuthKind = 'oAuth2' | 'apiKey';

interface ResolvedAuth {
	kind: AuthKind;
	credentialType: 'simplyPrintOAuth2Api' | 'simplyPrintApi';
	panelUrl: string;
	companyId: number;
}

/**
 * Read the node parameter `authentication` (expected to be on every
 * SimplyPrint node and trigger) and load the matching credential. Also
 * resolves the target companyId (cached in workflow static data for
 * OAuth2 since the token is bound to a single company but we only know
 * which one by calling GetUser).
 */
async function resolveAuth(ctx: SimplyprintContext): Promise<ResolvedAuth> {
	const kind = ctx.getNodeParameter('authentication', 0, 'oAuth2') as AuthKind;

	if (kind === 'apiKey') {
		const creds = await ctx.getCredentials('simplyPrintApi');
		const panelUrl = String(creds.panelUrl ?? 'https://simplyprint.io').replace(/\/+$/, '');
		const companyId = Number(creds.companyId);
		if (!Number.isFinite(companyId) || companyId <= 0) {
			throw new NodeApiError(ctx.getNode(), {
				message: 'SimplyPrint API-key credential has no valid Company ID.',
			});
		}
		return { kind, credentialType: 'simplyPrintApi', panelUrl, companyId };
	}

	const creds = await ctx.getCredentials('simplyPrintOAuth2Api');
	const panelUrl = String(creds.panelUrl ?? 'https://simplyprint.io').replace(/\/+$/, '');
	const companyId = await resolveOAuthCompany(ctx, panelUrl);
	return { kind, credentialType: 'simplyPrintOAuth2Api', panelUrl, companyId };
}

const OAUTH_COMPANY_CACHE_PREFIX = 'simplyPrintCompany:';

function oauthCompanyCacheKey(panelUrl: string): string {
	return `${OAUTH_COMPANY_CACHE_PREFIX}${panelUrl}`;
}

/**
 * Drop the cached OAuth company id for `panelUrl`. Called when SimplyPrint
 * rejects a request with "OAuth2 token is not valid for this company": the
 * cache survives reauth + credential swaps within a single workflow, so a
 * token that's been rebound to a different org will keep hitting the wrong
 * /api/{companyId}/... path forever otherwise.
 */
function invalidateOAuthCompanyCache(ctx: SimplyprintContext, panelUrl: string): void {
	const staticData = ctx.getWorkflowStaticData('global') as IDataObject;
	delete staticData[oauthCompanyCacheKey(panelUrl)];
}

function isCompanyMismatchError(input: unknown): boolean {
	if (!input) return false;
	const e = input as {
		message?: string;
		description?: string;
		cause?: { message?: string; description?: string };
	};
	const haystack = [e.message, e.description, e.cause?.message, e.cause?.description]
		.filter((v): v is string => typeof v === 'string')
		.join(' ')
		.toLowerCase();
	return haystack.includes('not valid for this company');
}

/**
 * Resolve (and cache) the OAuth2 token's bound company via `GET /api/0/account/GetUser`.
 * The patched GetUser endpoint returns `{ user, company }` for OAuth callers
 * (see api/API/Endpoints/account/GetUser.php).
 *
 * Cache lives in workflow static data keyed by panel URL. The cache can go
 * stale across reauth / admin-side org rebinding; `simplyprintCall` watches
 * for SP's company-mismatch error and drops the entry via
 * `invalidateOAuthCompanyCache` so the next request re-resolves.
 */
async function resolveOAuthCompany(ctx: SimplyprintContext, panelUrl: string): Promise<number> {
	const staticData = ctx.getWorkflowStaticData('global') as IDataObject;
	const cacheKey = oauthCompanyCacheKey(panelUrl);
	const cached = staticData[cacheKey];
	if (typeof cached === 'number' && cached > 0) return cached;

	const res = await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'simplyPrintOAuth2Api', {
		method: 'GET',
		url: `${panelUrl}/api/0/account/GetUser`,
		json: true,
	} as IHttpRequestOptions);

	const body = res as { status?: boolean; company?: { id?: number }; message?: string };
	if (!body?.status) {
		throw new NodeApiError(ctx.getNode(), {
			message: body?.message ?? 'SimplyPrint rejected the OAuth2 token.',
		});
	}
	const id = Number(body.company?.id);
	if (!Number.isFinite(id) || id <= 0) {
		throw new NodeApiError(ctx.getNode(), {
			message: 'SimplyPrint OAuth2 token is not bound to a company.',
		});
	}
	staticData[cacheKey] = id;
	return id;
}

/**
 * Issue a SimplyPrint API call. Auto-prefixes the company segment, injects
 * the right auth (OAuth2 Bearer or X-API-Key header) via
 * `httpRequestWithAuthentication`, and unwraps the `{ status, message?,
 * objects? }` envelope - throwing on `status === false`.
 */
export async function simplyprintCall<T = unknown>(
	ctx: SimplyprintContext,
	opts: SimplyprintCallOptions,
): Promise<SimplyprintResponse<T>> {
	let auth = await resolveAuth(ctx);
	let companyId = opts.company !== undefined ? opts.company : auth.companyId;
	// Auto-retry the request once after re-resolving the OAuth company if SP
	// reports the cached company is wrong. Only kicks in when we picked the
	// company ourselves (`opts.company === undefined`) and the auth is OAuth2.
	const canSelfHealCompany = () => opts.company === undefined && auth.kind === 'oAuth2';

	const buildRequest = (cid: number): IHttpRequestOptions => {
		const url = opts.baseUrlOverride
			? `${opts.baseUrlOverride.replace(/\/+$/, '')}/${cid}/${opts.path.replace(/^\//, '')}`
			: `${auth.panelUrl}/api/${cid}/${opts.path.replace(/^\//, '')}`;
		const request: IHttpRequestOptions = {
			method: opts.method,
			url,
			qs: opts.qs,
			json: true,
		};
		if (opts.formData) {
			// httpRequestWithAuthentication supports `body` + `formData`-shaped
			// requests by setting body to the object and disabling json.
			request.body = opts.formData;
			request.json = false;
		} else if (opts.body !== undefined) {
			request.body = opts.body;
		}
		return request;
	};

	let response: unknown;
	let thrown: unknown;
	try {
		response = await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			auth.credentialType,
			buildRequest(companyId),
		);
	} catch (error) {
		thrown = error;
	}

	const responseLooksMismatched = (r: unknown): boolean => {
		const body = r as SimplyprintResponse<T> | undefined;
		return (
			!!body &&
			body.status === false &&
			isCompanyMismatchError({ message: body.message })
		);
	};

	if (
		canSelfHealCompany() &&
		(isCompanyMismatchError(thrown) || responseLooksMismatched(response))
	) {
		invalidateOAuthCompanyCache(ctx, auth.panelUrl);
		auth = await resolveAuth(ctx);
		companyId = auth.companyId;
		thrown = undefined;
		try {
			response = await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				auth.credentialType,
				buildRequest(companyId),
			);
		} catch (retryError) {
			thrown = retryError;
		}
	}

	if (thrown) {
		throw new NodeApiError(ctx.getNode(), thrown as JsonObject);
	}

	const body = response as SimplyprintResponse<T>;
	if (!body || body.status === false) {
		throw new NodeApiError(ctx.getNode(), {
			message: body?.message ?? `SimplyPrint ${opts.method} ${opts.path} failed`,
		});
	}
	return body;
}

/**
 * Variant for lifecycle hooks that don't have access to node parameters the
 * way execute does - reads auth kind directly from the hook context.
 */
export async function simplyprintHookCall<T = unknown>(
	ctx: IHookFunctions,
	opts: SimplyprintCallOptions,
): Promise<SimplyprintResponse<T>> {
	return simplyprintCall<T>(ctx, opts);
}
