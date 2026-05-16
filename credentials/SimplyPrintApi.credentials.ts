import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * API-key credential for SimplyPrint. Unlike OAuth2, API keys are not bound
 * to a specific company, so the user must supply the numeric Company ID
 * explicitly. We inject the key as `X-API-Key` on every outgoing request.
 */
export class SimplyPrintApi implements ICredentialType {
	name = 'simplyPrintApi';

	displayName = 'SimplyPrint API';

	documentationUrl = 'https://simplyprint.io/integrations/n8n';

	icon = 'file:../nodes/SimplyPrint/simplyprint.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'Panel URL',
			name: 'panelUrl',
			type: 'string',
			default: 'https://simplyprint.io',
			description:
				'SimplyPrint panel base URL. Defaults to production. Override to https://test.simplyprint.io for the staging environment.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Generate an API key in SimplyPrint under Panel -> Settings -> API Keys. Treat it like a password.',
		},
		{
			displayName: 'Company ID',
			name: 'companyId',
			type: 'number',
			default: 0,
			required: true,
			description:
				'Numeric ID of the SimplyPrint organisation this connection targets (visible in panel URL, e.g. simplyprint.io/panel/123/...)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.panelUrl}}/api',
			url: '/0/account/GetUser',
			method: 'GET',
		},
	};
}
