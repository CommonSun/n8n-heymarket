import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class HeymarketApi implements ICredentialType {
	name = 'heymarketApi';

	displayName = 'Heymarket API';

	icon: Icon = {
		light: 'file:../nodes/Heymarket/heymarket.svg',
		dark: 'file:../nodes/Heymarket/heymarket.dark.svg',
	};

	documentationUrl = 'https://github.com/CommonSun/n8n-heymarket#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your n8n API key from Heymarket, found under Manage Integrations. This is separate from the Zapier key — a Zapier key will not work here.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.heymarket.com',
			description: 'Change this only if Heymarket support asks you to',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Heymarket-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	// A Heymarket API key belongs to exactly one team. The response carries the team
	// name so the save dialog can tell the user which team they just connected, which
	// is the only point in the flow where that is visible.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/n8n/v1/test_auth',
			method: 'GET',
		},
	};
}
