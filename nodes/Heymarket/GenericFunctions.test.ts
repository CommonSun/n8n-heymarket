import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	createList,
	createOrUpdateContact,
	createTrigger,
	deleteTrigger,
	extractErrorCode,
	getContactFields,
	interpretError,
	loadNamedOptions,
	sendMessage,
	sendTemplateMessage,
	updateListMembership,
	type HeymarketContext,
} from './GenericFunctions';

const API_KEY = 'test-key-not-a-real-credential';

interface MockContext {
	context: HeymarketContext;
	request: ReturnType<typeof vi.fn>;
}

/**
 * Builds a context that stands in for the n8n execution helpers. `request`
 * captures the options the code under test passed to n8n's authenticated HTTP
 * helper, which is what the assertions below inspect.
 */
function mockContext(response: unknown = {}, baseUrl = 'https://api.example.test'): MockContext {
	const request = vi.fn().mockResolvedValue(response);

	const context = {
		getCredentials: vi.fn().mockResolvedValue({ apiKey: API_KEY, baseUrl }),
		getNode: vi.fn().mockReturnValue({ name: 'Heymarket', type: 'heymarket', typeVersion: 1 }),
		helpers: { httpRequestWithAuthentication: request },
	} as unknown as HeymarketContext;

	return { context, request };
}

/** The options object the code passed to the HTTP helper on its first call. */
function requestOptions(request: ReturnType<typeof vi.fn>) {
	return request.mock.calls[0][1] as {
		method: string;
		url: string;
		body?: Record<string, unknown>;
		json?: boolean;
	};
}

describe('heymarketApiRequest transport', () => {
	it('routes through the authenticated helper under the credential name', async () => {
		const { context, request } = mockContext({ id: 1 });

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][0]).toBe('heymarketApi');
		expect(requestOptions(request).json).toBe(true);
	});

	it('builds the URL from the credential base URL and the versioned base path', async () => {
		const { context, request } = mockContext({ id: 1 }, 'https://api.example.test');

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/messages');
	});

	it('trims trailing slashes off the credential base URL', async () => {
		const { context, request } = mockContext({ id: 1 }, 'https://api.example.test///');

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/messages');
	});
});

describe('sendMessage', () => {
	it('sends inbox, phone number and text in the API field names', async () => {
		const { context, request } = mockContext({ id: 8842 });

		const result = await sendMessage(context, {
			inboxId: 10,
			phoneNumber: '+15005550001',
			text: 'Hi',
		});

		expect(requestOptions(request).method).toBe('POST');
		expect(requestOptions(request).body).toEqual({
			inbox_id: 10,
			phone_number: '+15005550001',
			text: 'Hi',
		});
		expect(result).toEqual({ id: 8842 });
	});

	it('does not send a template id', async () => {
		const { context, request } = mockContext({ id: 8842 });

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(requestOptions(request).body).not.toHaveProperty('template_id');
	});
});

describe('sendTemplateMessage', () => {
	it('sends a template id instead of text', async () => {
		const { context, request } = mockContext({ id: 8843 });

		await sendTemplateMessage(context, {
			inboxId: 10,
			phoneNumber: '+15005550001',
			templateId: 7,
		});

		expect(requestOptions(request).body).toEqual({
			inbox_id: 10,
			phone_number: '+15005550001',
			template_id: 7,
		});
		expect(requestOptions(request).body).not.toHaveProperty('text');
	});
});

describe('createOrUpdateContact', () => {
	it('sends only the phone number when nothing else is set', async () => {
		const { context, request } = mockContext({ id: 901, created: true });

		await createOrUpdateContact(context, { phoneNumber: '+15005550001' });

		expect(requestOptions(request).body).toEqual({ phone_number: '+15005550001' });
	});

	it('maps camelCase options onto the API field names', async () => {
		const { context, request } = mockContext({ id: 901, created: true });

		await createOrUpdateContact(context, {
			phoneNumber: '+15005550001',
			firstName: 'Jane',
			lastName: 'Doe',
			email: 'jane@example.test',
			note: 'VIP',
		});

		expect(requestOptions(request).body).toEqual({
			phone_number: '+15005550001',
			first_name: 'Jane',
			last_name: 'Doe',
			email: 'jane@example.test',
			note: 'VIP',
		});
	});

	it('omits blank optional fields so an empty box never clears a stored value', async () => {
		const { context, request } = mockContext({ id: 901, created: false });

		await createOrUpdateContact(context, {
			phoneNumber: '+15005550001',
			firstName: '',
			lastName: undefined,
			email: '',
			note: '',
		});

		expect(requestOptions(request).body).toEqual({ phone_number: '+15005550001' });
	});

	it('omits an empty custom field map', async () => {
		const { context, request } = mockContext({ id: 901, created: false });

		await createOrUpdateContact(context, { phoneNumber: '+15005550001', custom: {} });

		expect(requestOptions(request).body).not.toHaveProperty('custom');
	});

	it('sends custom fields as a nested object', async () => {
		const { context, request } = mockContext({ id: 901, created: false });

		await createOrUpdateContact(context, {
			phoneNumber: '+15005550001',
			custom: { 'Account Tier': 'gold' },
		});

		expect(requestOptions(request).body).toEqual({
			phone_number: '+15005550001',
			custom: { 'Account Tier': 'gold' },
		});
	});
});

describe('updateListMembership', () => {
	it('puts the list id in the path and the action in the body', async () => {
		const { context, request } = mockContext({ list_id: 22, member_count: 41 });

		await updateListMembership(context, 22, 'add', '+15005550001');

		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/lists/22/members');
		expect(requestOptions(request).body).toEqual({
			action: 'add',
			phone_number: '+15005550001',
		});
	});

	it('passes the remove action through unchanged', async () => {
		const { context, request } = mockContext({ list_id: 22, member_count: 40 });

		await updateListMembership(context, 22, 'remove', '+15005550001');

		expect(requestOptions(request).body).toMatchObject({ action: 'remove' });
	});
});

describe('createTrigger', () => {
	it('includes inbox_id when the event is scoped to an inbox', async () => {
		const { context, request } = mockContext({ id: 'hk_9f2c' });

		const result = await createTrigger(
			context,
			'incoming_message',
			'https://n8n.example.test/webhook/9f2c',
			false,
			10,
		);

		expect(requestOptions(request).body).toEqual({
			event: 'incoming_message',
			url: 'https://n8n.example.test/webhook/9f2c',
			send_sample: false,
			inbox_id: 10,
		});
		expect(result.id).toBe('hk_9f2c');
	});

	it('omits inbox_id entirely for account-wide events', async () => {
		const { context, request } = mockContext({ id: 'hk_a1b8' });

		await createTrigger(
			context,
			'contact_updated',
			'https://n8n.example.test/webhook/a1b8',
			false,
		);

		expect(requestOptions(request).body).not.toHaveProperty('inbox_id');
	});

	it('forwards send_sample so the server can emit a sample event', async () => {
		const { context, request } = mockContext({ id: 'hk_test' });

		await createTrigger(
			context,
			'incoming_message',
			'https://n8n.example.test/webhook-test/abc',
			true,
			10,
		);

		expect(requestOptions(request).body).toMatchObject({ send_sample: true });
	});
});

describe('deleteTrigger', () => {
	it('issues a DELETE against the subscription id', async () => {
		const { context, request } = mockContext({});

		await deleteTrigger(context, 'hk_9f2c');

		expect(requestOptions(request).method).toBe('DELETE');
		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/triggers/hk_9f2c');
	});
});

describe('loadNamedOptions', () => {
	it('maps id and name onto the value and name a dropdown expects', async () => {
		const { context } = mockContext([
			{ id: 10, name: 'Support' },
			{ id: 11, name: 'Sales' },
		]);

		const options = await loadNamedOptions(context as never, '/inboxes');

		expect(options).toEqual([
			{ name: 'Support', value: 10 },
			{ name: 'Sales', value: 11 },
		]);
	});

	it('returns an empty list when the response is not an array', async () => {
		const { context } = mockContext({ unexpected: true });

		expect(await loadNamedOptions(context as never, '/inboxes')).toEqual([]);
	});
});

describe('getContactFields', () => {
	// The id is the value, not the title. Heymarket validates custom-field keys
	// against the team's field ids and drops anything else, so a title-keyed write
	// returns 200 with the field silently missing.
	it('labels with the title and sends the id as a string', async () => {
		const { context, request } = mockContext([
			{ id: 40, name: 'Account Number' },
			{ id: 41, name: 'Renewal Date' },
		]);

		const options = await getContactFields(context as never);

		expect(options).toEqual([
			{ name: 'Account Number', value: '40' },
			{ name: 'Renewal Date', value: '41' },
		]);
		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/contact_fields');
		expect(requestOptions(request).method).toBe('GET');
	});

	it('returns an empty list when the response is not an array', async () => {
		const { context } = mockContext({ unexpected: true });

		expect(await getContactFields(context as never)).toEqual([]);
	});
});

describe('extractErrorCode', () => {
	it('reads the code from a response body', () => {
		expect(extractErrorCode({ response: { body: { error_code: 'inbox_not_found' } } })).toBe(
			'inbox_not_found',
		);
	});

	it('reads the code from a response data field', () => {
		expect(extractErrorCode({ response: { data: { error_code: 'rate_limited' } } })).toBe(
			'rate_limited',
		);
	});

	it('reads the code from a nested cause', () => {
		expect(extractErrorCode({ cause: { error: { error_code: 'invalid_phone_number' } } })).toBe(
			'invalid_phone_number',
		);
	});

	it('returns an empty string for a transport failure with no API body', () => {
		expect(extractErrorCode(new Error('socket hang up'))).toBe('');
	});

	it('returns an empty string when the body carries no code', () => {
		expect(extractErrorCode({ response: { body: { message: 'gateway timeout' } } })).toBe('');
	});
});

describe('interpretError', () => {
	const { context } = mockContext();

	it('classifies internal_error as retryable', () => {
		const error = interpretError(context, { response: { body: { error_code: 'internal_error' } } });

		expect(error).toBeInstanceOf(NodeApiError);
	});

	it('classifies rate_limited as retryable', () => {
		const error = interpretError(context, { response: { body: { error_code: 'rate_limited' } } });

		expect(error).toBeInstanceOf(NodeApiError);
	});

	it('treats a transport failure as retryable rather than failing the workflow', () => {
		expect(interpretError(context, new Error('ECONNRESET'))).toBeInstanceOf(NodeApiError);
	});

	it('classifies a bad inbox as a permanent operation error', () => {
		const error = interpretError(context, {
			response: { body: { error_code: 'inbox_not_found' } },
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error).not.toBeInstanceOf(NodeApiError);
	});

	it('classifies an opt-out as permanent and explains it in plain language', () => {
		const error = interpretError(context, {
			response: { body: { error_code: 'unsubscribed_number' } },
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toContain('opted out');
	});

	it('explains an unusable key without repeating the raw API text', () => {
		const error = interpretError(context, {
			response: { body: { error_code: 'invalid_api_key', message: 'API key not recognized.' } },
		});

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toContain('Zapier key will not work');
	});

	it('names the error code in the description so the raw code stays visible', () => {
		const error = interpretError(context, {
			response: { body: { error_code: 'no_sender_available' } },
		});

		expect(error.description).toContain('no_sender_available');
	});

	it('carries the item index through for per-item error routing', () => {
		const error = interpretError(
			context,
			{ response: { body: { error_code: 'inbox_not_found' } } },
			3,
		);

		expect(error.context.itemIndex).toBe(3);
	});
});

describe('createList', () => {
	it('sends only the title when no seed values are given', async () => {
		const { context, request } = mockContext({ id: 22, name: 'VIPs', member_count: 0 });

		await createList(context, { title: 'VIPs' });

		expect(requestOptions(request).url).toBe('https://api.example.test/n8n/v1/lists');
		expect(requestOptions(request).method).toBe('POST');
		expect(requestOptions(request).body).toEqual({ title: 'VIPs' });
	});

	it('omits empty seed arrays rather than sending them', async () => {
		const { context, request } = mockContext({ id: 22 });

		await createList(context, { title: 'VIPs', phones: [], emails: [] });

		expect(requestOptions(request).body).not.toHaveProperty('phones');
		expect(requestOptions(request).body).not.toHaveProperty('emails');
	});

	it('sends phones and emails under the API field names', async () => {
		const { context, request } = mockContext({ id: 22, member_count: 3 });

		await createList(context, {
			title: 'Seeded',
			phones: ['+15005550001', '+15005550002'],
			emails: ['a@example.test'],
		});

		expect(requestOptions(request).body).toEqual({
			title: 'Seeded',
			phones: ['+15005550001', '+15005550002'],
			emails: ['a@example.test'],
		});
	});

	it('passes the response through whole so new server fields reach the workflow', async () => {
		const { context } = mockContext({ id: 22, name: 'VIPs', member_count: 3, future_field: 'x' });

		const result = await createList(context, { title: 'VIPs' });

		expect(result).toEqual({ id: 22, name: 'VIPs', member_count: 3, future_field: 'x' });
	});
});
