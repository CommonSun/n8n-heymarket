import { describe, expect, it, vi } from 'vitest';

import {
	createList,
	createOrUpdateContact,
	createTrigger,
	deleteTrigger,
	sendMessage,
	sendTemplateMessage,
	updateListMembership,
	type HeymarketContext,
} from './GenericFunctions';

const API_KEY = 'test-key-not-a-real-credential';
const DRY_RUN_HEADER = 'X-Heymarket-Dry-Run';

/**
 * Like the harness in GenericFunctions.test.ts, but with `getMode`, which is what
 * decides whether a request is a simulation.
 */
function mockContext(mode?: string) {
	const request = vi.fn().mockResolvedValue({});

	const context = {
		getCredentials: vi
			.fn()
			.mockResolvedValue({ apiKey: API_KEY, baseUrl: 'https://api.example.test' }),
		getNode: vi.fn().mockReturnValue({ name: 'Heymarket', type: 'heymarket', typeVersion: 1 }),
		helpers: { httpRequestWithAuthentication: request },
		...(mode === undefined ? {} : { getMode: () => mode }),
	} as unknown as HeymarketContext;

	return { context, request };
}

function sentHeaders(request: ReturnType<typeof vi.fn>): Record<string, string> | undefined {
	return (request.mock.calls[0][1] as { headers?: Record<string, string> }).headers;
}

describe('dry run mode detection', () => {
	it('marks editor-initiated runs so the server performs no work', async () => {
		const { context, request } = mockContext('manual');

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(sentHeaders(request)).toEqual({ [DRY_RUN_HEADER]: 'true' });
	});

	// A published workflow firing for real must be untouched by any of this.
	it.each(['trigger', 'webhook', 'retry', 'cli', 'integrated', 'evaluation', 'chat', 'agent'])(
		'leaves %s executions real',
		async (mode) => {
			const { context, request } = mockContext(mode);

			await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

			expect(sentHeaders(request)).toBeUndefined();
		},
	);

	it('leaves the request real when the context has no mode at all', async () => {
		const { context, request } = mockContext();

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' });

		expect(sentHeaders(request)).toBeUndefined();
	});

	it('lets the user opt into a real action from the editor', async () => {
		const { context, request } = mockContext('manual');

		await sendMessage(context, { inboxId: 10, phoneNumber: '+15005550001', text: 'Hi' }, true);

		expect(sentHeaders(request)).toBeUndefined();
	});
});

describe('every write helper honours manual mode', () => {
	const phone = '+15005550001';

	const writes: Array<[string, (context: HeymarketContext) => Promise<unknown>]> = [
		['sendMessage', (c) => sendMessage(c, { inboxId: 10, phoneNumber: phone, text: 'Hi' })],
		[
			'sendTemplateMessage',
			(c) => sendTemplateMessage(c, { inboxId: 10, phoneNumber: phone, templateId: 5 }),
		],
		['createOrUpdateContact', (c) => createOrUpdateContact(c, { phoneNumber: phone })],
		['createList', (c) => createList(c, { title: 'List' })],
		['updateListMembership', (c) => updateListMembership(c, 20, 'add', phone)],
	];

	it.each(writes)('%s sends the header on a manual run', async (_name, call) => {
		const { context, request } = mockContext('manual');

		await call(context);

		expect(sentHeaders(request)).toEqual({ [DRY_RUN_HEADER]: 'true' });
	});

	it.each(writes)('%s sends no header on a triggered run', async (_name, call) => {
		const { context, request } = mockContext('trigger');

		await call(context);

		expect(sentHeaders(request)).toBeUndefined();
	});
});

// A test listen in the editor is a manual-mode webhook registration. Without a real
// subscription the test event can never arrive, so these two ignore the mode.
describe('trigger subscriptions are real in every mode', () => {
	const subscriptions: Array<[string, (context: HeymarketContext) => Promise<unknown>]> = [
		[
			'createTrigger without sample',
			(c) => createTrigger(c, 'incoming_message', 'https://example.test/h', false, 7),
		],
		[
			'createTrigger with sample',
			(c) => createTrigger(c, 'incoming_message', 'https://example.test/h', true, 7),
		],
		['deleteTrigger', (c) => deleteTrigger(c, 'hook-1')],
	];

	it.each(subscriptions)('%s sends no header on a manual run', async (_name, call) => {
		const { context, request } = mockContext('manual');

		await call(context);

		expect(sentHeaders(request)).toBeUndefined();
	});

	it.each(subscriptions)('%s sends no header on a triggered run', async (_name, call) => {
		const { context, request } = mockContext('trigger');

		await call(context);

		expect(sentHeaders(request)).toBeUndefined();
	});
});
