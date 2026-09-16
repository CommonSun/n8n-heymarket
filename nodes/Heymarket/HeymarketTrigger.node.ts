import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { createTrigger, deleteTrigger, getInboxes, interpretError } from './GenericFunctions';

/** Events that are account-wide rather than per-inbox. Contacts have no inbox. */
const TEAM_WIDE_EVENTS = new Set(['contact_updated']);

export class HeymarketTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Heymarket Trigger',
		name: 'heymarketTrigger',
		icon: { light: 'file:heymarket.svg', dark: 'file:heymarket.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when something happens in Heymarket',
		defaults: {
			name: 'Heymarket Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'heymarketApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// Heymarket delivery is fire-and-forget with a short timeout, so acknowledge
				// on receipt rather than making it wait for the workflow to finish.
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				default: 'incoming_message',
				description: 'The Heymarket event that starts this workflow',
				options: [
					{
						name: 'Chat Started (Inbound)',
						value: 'chat_started_inbound',
						description: 'A contact started a new conversation',
					},
					{
						name: 'Chat Started (Outbound)',
						value: 'chat_started_outbound',
						description: 'A team member started a new conversation',
					},
					{
						name: 'Contact Updated',
						value: 'contact_updated',
						description: 'A contact was created or changed. Applies to the whole account.',
					},
					{
						name: 'Incoming Call',
						value: 'incoming_phone_call',
						description: 'An inbound phone call was received',
					},
					{
						name: 'Message Received',
						value: 'incoming_message',
						description: 'A contact sent a message',
					},
					{
						name: 'Message Sent',
						value: 'outgoing_message',
						description:
							'A team member sent a message. Messages sent by integrations, including this one, do not fire this event.',
					},
					{
						name: 'Opt-Out Received',
						value: 'incoming_message_unsubscribe',
						description: 'A contact replied with an opt-out keyword',
					},
				],
			},
			{
				displayName: 'Inbox Names or IDs',
				name: 'inboxIds',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getInboxes',
				},
				required: true,
				default: [],
				displayOptions: {
					hide: {
						event: ['contact_updated'],
					},
				},
				description:
					'The inboxes to watch. Every inbox on the team the API key belongs to is listed, including inboxes you are not a member of: the key authenticates as the team and carries no user identity. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await getInboxes(this);
			},
		},
	};

	webhookMethods = {
		default: {
			/**
			 * Always false. Heymarket exposes no endpoint for listing existing
			 * subscriptions, so there is nothing to check against — the stored IDs in
			 * workflow static data are the only record that a subscription exists.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const event = this.getNodeParameter('event') as string;

				// n8n has no sample-event button, and pinned data on webhook-style nodes can
				// put the node back into listening mode instead of using the pin. Detecting
				// the test URL by substring keeps this off n8n internals.
				const sendSample = webhookUrl.includes('/webhook-test/');

				// One subscription per inbox, because a subscription holds a single inbox.
				// The fan-out lives here so the user sees one control. Account-wide events
				// take a single subscription with no inbox at all.
				const targets: Array<number | undefined> = TEAM_WIDE_EVENTS.has(event)
					? [undefined]
					: (this.getNodeParameter('inboxIds', []) as Array<number | string>).map(Number);

				const hookIds: string[] = [];

				for (const inboxId of targets) {
					try {
						const response = await createTrigger(this, event, webhookUrl, sendSample, inboxId);
						hookIds.push(response.id);
					} catch (error) {
						// Roll back the subscriptions already created, otherwise a failure
						// halfway through leaves rows nothing will ever clean up — n8n does
						// not call delete() for an activation that failed.
						await Promise.all(
							hookIds.map(async (id) => {
								try {
									await deleteTrigger(this, id);
								} catch {
									// Best effort. The original error is what the user needs to see.
								}
							}),
						);
						throw interpretError(this, error);
					}
				}

				this.getWorkflowStaticData('node').hookIds = hookIds;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const hookIds = (staticData.hookIds as string[] | undefined) ?? [];

				for (const hookId of hookIds) {
					try {
						await deleteTrigger(this, hookId);
					} catch (error) {
						// Deactivation has to succeed even when cleanup does not, otherwise a
						// workflow cannot be switched off. Heymarket reclaims orphans itself.
						this.logger.warn(
							`Heymarket Trigger: could not remove subscription ${hookId}: ${(error as Error).message}`,
						);
					}
				}

				delete staticData.hookIds;

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();
		const events = (Array.isArray(bodyData) ? bodyData : [bodyData]) as IDataObject[];
		const event = this.getNodeParameter('event') as string;

		// Older Heymarket payloads omit inbox_id on some events. Fill it from the node
		// config only when a single inbox is configured — with several selected there is
		// no way to know which one an event came from, and guessing is worse than absent.
		// Never overwrite a value the server sent: additive server-side fields are what
		// let an older node run against a newer API and vice versa.
		if (!TEAM_WIDE_EVENTS.has(event)) {
			const configuredInboxIds = this.getNodeParameter('inboxIds', []) as Array<number | string>;

			if (configuredInboxIds.length === 1) {
				const fallbackInboxId = Number(configuredInboxIds[0]);

				for (const item of events) {
					if (item.inbox_id === undefined) {
						item.inbox_id = fallbackInboxId;
					}
				}
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray(events)],
		};
	}
}
