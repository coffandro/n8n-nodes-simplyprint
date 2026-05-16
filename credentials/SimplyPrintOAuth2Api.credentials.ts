import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * OAuth2 credential for SimplyPrint.
 *
 * `extends: ['oAuth2Api']` pulls in n8n's standard OAuth2 form (client id,
 * client secret, redirect URL). We override each of those fields with
 * `type: 'hidden'` + a pre-baked default so the user sees zero form fields
 * - just a "Connect" button - and connects against the shared SimplyPrint
 * "n8n (managed)" OAuth client.
 *
 * That OAuth client has `allow_any_redirect: true` on the SP backend,
 * which means any n8n instance (cloud or self-hosted) can authenticate
 * without its callback URL being pre-whitelisted. The SP consent screen
 * shows a yellow "you're approving a third-party-hosted instance" warning
 * with the redirect URL displayed and a mandatory "I trust this destination"
 * checkbox for redirects SP hasn't seen before.
 *
 * The `client_secret` shipped here is effectively public (anyone can
 * `npm install` this package and extract it). That's an accepted tradeoff
 * matching how Zapier / Make / Pipedream ship their integrations; the real
 * security boundary is the SP consent screen's redirect URL warning.
 */
export class SimplyPrintOAuth2Api implements ICredentialType {
	name = 'simplyPrintOAuth2Api';

	displayName = 'SimplyPrint OAuth2 API';

	documentationUrl = 'https://simplyprint.io/integrations/n8n';

	icon = 'file:../nodes/SimplyPrint/simplyprint.svg' as const;

	extends = ['oAuth2Api'];

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Panel URL',
			name: 'panelUrl',
			type: 'string',
			default: 'https://simplyprint.io',
			description:
				'SimplyPrint panel base URL. Defaults to production. Override to https://test.simplyprint.io for the staging environment.',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'hidden',
			default: 'n8n',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'hidden',
			typeOptions: { password: true },
			default: 'febe59df3f9668c56c6d4a96e53aaa508a0efe9e1e3d3955a4222bd58c555e7b',
		},
		{
			// Consent screen lives under /panel/oauth2/authorize - the Pattern()
			// wrapper in panel-routes.php prepends /panel. The bare /oauth/authorize
			// path is the MCP Dynamic Client Registration flow, a different registry.
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["panelUrl"]}}/panel/oauth2/authorize',
		},
		{
			// Token exchange is an API endpoint, company-scopeless (0).
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["panelUrl"]}}/api/0/oauth2/Token',
		},
		{
			// Space-separated per RFC 6749. League's OAuth2 server parses scope
			// by space. (SP also has a `comma_separated` validator on scope, but
			// it's effectively a no-op without a type param - it neither splits
			// nor validates individual elements.)
			//
			// Intentionally omitted:
			// - `custom_fields.write`: not currently granted to OAuth tokens;
			//   requesting it breaks the consent screen. Custom-field writes go
			//   via `custom_fields/SubmitValues` which is gated by other scopes
			//   (queue.write, files.write, ...) depending on the target entity.
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default:
				'user.read printers.read printers.write printers.actions queue.read queue.write files.read files.write files.temp_upload spools.read spools.write print_history.read statistics.read custom_fields.read tags.read webhooks.read webhooks.write',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'header',
		},
	];
}
