import type { IHookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { HeymarketTrigger } from './HeymarketTrigger.node';

const API_KEY = 'test-key-not-a-real-credential';
const TEST_WEBHOOK_URL = 'https://n8n.example.test/webhook-test/wf-1/webhook';
const INBOX_IDS = [7, 8];

function mockHookContext(responses: unknown[]) {
	const request = vi.fn();
	for (const response of responses) request.mockResolvedValueOnce(response);
	request.mockResolvedValue({});

	const staticData: Record<string, unknown> = {};
	const parameters: Record<string, unknown> = { event: 'incoming_message', inboxIds: INBOX_IDS };

	const context = {
		getCredentials: vi
			.fn()
			.mockResolvedValue({ apiKey: API_KEY, baseUrl: 'https://api.example.test' }),
		getNode: vi.fn().mockReturnValue({ name: 'Heymarket Trigger', type: 'heymarketTrigger' }),
		getNodeWebhookUrl: vi.fn().mockReturnValue(TEST_WEBHOOK_URL),
		getNodeParameter: vi.fn((name: string, fallback?: unknown) => parameters[name] ?? fallback),
		getWorkflowStaticData: vi.fn().mockReturnValue(staticData),
		getMode: () => 'manual',
		helpers: { httpRequestWithAuthentication: request },
	} as unknown as IHookFunctions;

	return { context, request, staticData };
}

function requestsTo(request: ReturnType<typeof vi.fn>) {
	return request.mock.calls.map((call) => {
		const options = call[1] as { method: string; url: string; headers?: unknown; body?: unknown };
		return { method: options.method, url: options.url, headers: options.headers, body: options.body };
	});
}

describe('HeymarketTrigger create', () => {
	const create = new HeymarketTrigger().webhookMethods.default.create;

	it('registers one real subscription per inbox from a test listen and stores the ids', async () => {
		const { context, request, staticData } = mockHookContext([{ id: 'hk_1' }, { id: 'hk_2' }]);

		await expect(create.call(context)).resolves.toBe(true);

		expect(staticData.hookIds).toEqual(['hk_1', 'hk_2']);

		const sent = requestsTo(request);
		expect(sent).toHaveLength(2);
		for (const [index, inboxId] of INBOX_IDS.entries()) {
			expect(sent[index].method).toBe('POST');
			expect(sent[index].url).toBe('https://api.example.test/n8n/v1/triggers');
			expect(sent[index].headers).toBeUndefined();
			expect(sent[index].body).toEqual({
				event: 'incoming_message',
				url: TEST_WEBHOOK_URL,
				send_sample: true,
				inbox_id: inboxId,
			});
		}
	});

	it('fails and rolls back when a response carries no subscription id', async () => {
		const { context, request, staticData } = mockHookContext([{ id: 'hk_1' }, { dry_run: true }]);

		await expect(create.call(context)).rejects.toBeInstanceOf(NodeOperationError);

		expect(staticData.hookIds).toBeUndefined();

		const sent = requestsTo(request);
		expect(sent.map((r) => r.method)).toEqual(['POST', 'POST', 'DELETE']);
		expect(sent[2].url).toBe('https://api.example.test/n8n/v1/triggers/hk_1');
	});
});
