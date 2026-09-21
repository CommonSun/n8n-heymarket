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
