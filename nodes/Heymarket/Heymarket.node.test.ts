import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { Heymarket } from './Heymarket.node';

const API_KEY = 'test-key-not-a-real-credential';

/** What n8n's HTTP helper rejects with when the API answers 4xx: the generic
 * transport message on the Error, the API body underneath it. */
function apiFailure(errorCode: string, message: string) {
	return Object.assign(new Error('Request failed with status code 400'), {
		response: { body: { error_code: errorCode, message } },
	});
}

function mockExecuteContext(rejectWith: unknown, continueOnFail: boolean) {
	const request = vi.fn().mockRejectedValue(rejectWith);
	const parameters: Record<string, unknown> = {
		resource: 'message',
		operation: 'send',
		inboxId: 10,
		phoneNumber: '+15005550001',
		text: 'Hi',
		performRealActions: true,
	};

	const context = {
		getInputData: vi.fn().mockReturnValue([{ json: {} }]),
		getNodeParameter: vi.fn(
			(name: string, _index: number, fallback?: unknown) => parameters[name] ?? fallback,
		),
		continueOnFail: vi.fn().mockReturnValue(continueOnFail),
		getCredentials: vi
			.fn()
			.mockResolvedValue({ apiKey: API_KEY, baseUrl: 'https://api.example.test' }),
		getNode: vi.fn().mockReturnValue({ name: 'Heymarket', type: 'heymarket', typeVersion: 1 }),
		getMode: () => 'trigger',
		helpers: { httpRequestWithAuthentication: request },
	} as unknown as IExecuteFunctions;

	return { context, request };
}

describe('Heymarket execute with Continue On Fail', () => {
	const execute = new Heymarket().execute;

	it('puts the API error_code and the friendly message on the error item', async () => {
		const { context } = mockExecuteContext(
			apiFailure('unsubscribed_number', 'Contact has opted out.'),
			true,
		);

		const [output] = await execute.call(context);

		expect(output).toHaveLength(1);
		expect(output[0].pairedItem).toEqual({ item: 0 });
		expect(output[0].json).toEqual({
			error: 'This contact has opted out of messages from this inbox.',
			error_code: 'unsubscribed_number',
		});
	});

	it('omits error_code when the failure never reached the API', async () => {
		const { context } = mockExecuteContext(new Error('socket hang up'), true);

		const [output] = await execute.call(context);

		expect(output).toHaveLength(1);
		expect(output[0].json).not.toHaveProperty('error_code');
		expect(typeof output[0].json.error).toBe('string');
		expect(output[0].json.error).not.toBe('');
	});

	it('still throws the interpreted error when Continue On Fail is off', async () => {
		const { context } = mockExecuteContext(
			apiFailure('unsubscribed_number', 'Contact has opted out.'),
			false,
		);

		await expect(execute.call(context)).rejects.toBeInstanceOf(NodeOperationError);
	});
});

describe('Heymarket execute for list membership', () => {
	const execute = new Heymarket().execute;

	it('sends the ID of the list picked from the dropdown', async () => {
		const listLocator = { __rl: true, mode: 'list', value: '21189' };
		const request = vi.fn().mockResolvedValue({ ok: true });
		const parameters: Record<string, unknown> = {
			resource: 'list',
			operation: 'addContact',
			listId: listLocator,
			phoneNumber: '+15005550001',
			performRealActions: true,
		};

		const context = {
			getInputData: vi.fn().mockReturnValue([{ json: {} }]),
			getNodeParameter: vi.fn(
				(
					name: string,
					_index: number,
					fallback?: unknown,
					options?: { extractValue?: boolean },
				) => {
					const value = parameters[name] ?? fallback;
					return options?.extractValue ? (value as { value: unknown }).value : value;
				},
			),
			continueOnFail: vi.fn().mockReturnValue(false),
			getCredentials: vi
				.fn()
				.mockResolvedValue({ apiKey: API_KEY, baseUrl: 'https://api.example.test' }),
			getNode: vi.fn().mockReturnValue({ name: 'Heymarket', type: 'heymarket', typeVersion: 1 }),
			getMode: () => 'trigger',
			helpers: { httpRequestWithAuthentication: request },
		} as unknown as IExecuteFunctions;

		await execute.call(context);

		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][1]).toMatchObject({
			method: 'POST',
			url: 'https://api.example.test/n8n/v1/lists/21189/members',
		});
	});
});

describe('Heymarket resource order', () => {
	it('lists Message first', () => {
		const resource = new Heymarket().description.properties.find(
			(property) => property.name === 'resource',
		);
		const values = ((resource?.options ?? []) as Array<{ value: string }>).map((o) => o.value);

		expect(values).toEqual(['message', 'contact', 'list']);
	});
});
