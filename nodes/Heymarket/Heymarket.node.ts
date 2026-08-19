import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	createList,
	createOrUpdateContact,
	getInboxes,
	getLists,
	getTemplates,
	interpretError,
	sendMessage,
	sendTemplateMessage,
	updateListMembership,
	type ListMemberAction,
} from './GenericFunctions';

/** Splits a comma-separated field into trimmed, non-empty values. */
function splitCsv(raw: string): string[] {
	return raw
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v !== '');
}

/**
 * Flattens the fixedCollection the UI produces into a plain name/value map.
 * Entries with a blank name are dropped — an empty row in the UI should not send
 * an empty custom field.
 */
function collectCustomFields(additionalFields: IDataObject): Record<string, string> | undefined {
	const customFieldsUi = additionalFields.customFieldsUi as IDataObject | undefined;
	const rows = customFieldsUi?.customFieldValues as Array<{ name: string; value: string }> | undefined;

	if (!rows?.length) {
		return undefined;
	}

	const custom: Record<string, string> = {};

	for (const row of rows) {
		if (row.name) {
			custom[row.name] = row.value;
		}
	}

	return Object.keys(custom).length > 0 ? custom : undefined;
}

/**
 * Programmatic rather than declarative because the Heymarket API returns a stable
 * `error_code` that has to be mapped onto NodeApiError versus NodeOperationError —
 * retryable versus not. Declarative routing cannot express that distinction, and
 * getting it wrong means either retrying a permanent failure or failing a workflow
 * on a transient one. The trigger node in this package is programmatic regardless,
 * since it manages webhook subscriptions.
 */
export class Heymarket implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Heymarket',
		name: 'heymarket',
		icon: { light: 'file:heymarket.svg', dark: 'file:heymarket.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send business text messages and manage contacts in Heymarket',
		defaults: {
			name: 'Heymarket',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'heymarketApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Contact',
						value: 'contact',
					},
					{
						name: 'List',
						value: 'list',
					},
					{
						name: 'Message',
						value: 'message',
					},
				],
				default: 'message',
			},

			// ----------------------------------
			//             message
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send a message with text you provide',
						action: 'Send a message',
					},
					{
						name: 'Send Template',
						value: 'sendTemplate',
						description: 'Send a message built from a saved Heymarket template',
						action: 'Send a template message',
					},
				],
				default: 'send',
			},
			{
				displayName: 'Inbox Name or ID',
				name: 'inboxId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getInboxes',
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				description:
					'The inbox the message is sent from. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				required: true,
				default: '',
				placeholder: '+15005550001',
				displayOptions: {
					show: {
						resource: ['message', 'contact', 'list'],
					},
					hide: {
						operation: ['create'],
					},
				},
				description: 'The contact phone number, in E.164 format',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['send'],
					},
				},
				description: 'The message body to send',
			},
			{
				displayName: 'Template Name or ID',
				name: 'templateId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTemplates',
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
				description:
					'The template to send. Merge fields are filled in by Heymarket. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},

			// ----------------------------------
			//             contact
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['contact'],
					},
				},
				options: [
					{
						name: 'Create or Update',
						value: 'createOrUpdate',
						description: 'Create a contact, or update it if the phone number already exists',
						action: 'Create or update a contact',
					},
				],
				default: 'createOrUpdate',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['contact'],
					},
				},
				options: [
					{
						displayName: 'Custom Fields',
						name: 'customFieldsUi',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
						},
						default: {},
						placeholder: 'Add Custom Field',
						options: [
							{
								displayName: 'Custom Field',
								name: 'customFieldValues',
								values: [
									{
										displayName: 'Name',
										name: 'name',
										type: 'string',
										default: '',
										description: 'The custom field name as configured in Heymarket',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description: 'Value to set for the custom field',
									},
								],
							},
						],
					},
					{
						displayName: 'Email',
						name: 'email',
						type: 'string',
						placeholder: 'name@email.com',
						default: '',
						description: 'Email address for the contact',
					},
					{
						displayName: 'First Name',
						name: 'firstName',
						type: 'string',
						default: '',
						description: 'First name for the contact',
					},
					{
						displayName: 'Last Name',
						name: 'lastName',
						type: 'string',
						default: '',
						description: 'Last name for the contact',
					},
					{
						displayName: 'Note',
						name: 'note',
						type: 'string',
						default: '',
						description: 'Free-text note stored on the contact',
					},
				],
			},

			// ----------------------------------
			//              list
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['list'],
					},
				},
				options: [
					{
						name: 'Add Contact',
						value: 'addContact',
						description: 'Add a contact to a list',
						action: 'Add a contact to a list',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a list, optionally seeded with members',
						action: 'Create a list',
					},
					{
						name: 'Remove Contact',
						value: 'removeContact',
						description: 'Remove a contact from a list',
						action: 'Remove a contact from a list',
					},
				],
				default: 'addContact',
			},
			{
				displayName: 'List Name or ID',
				name: 'listId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getLists',
				},
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['list'],
						operation: ['addContact', 'removeContact'],
					},
				},
				description:
					'The list to modify. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'VIP customers',
				displayOptions: {
					show: {
						resource: ['list'],
						operation: ['create'],
					},
				},
				description: 'The name of the new list',
			},
			{
				displayName: 'Phone Numbers',
				name: 'seedPhones',
				type: 'string',
				default: '',
				placeholder: '+15005550001, +15005550002',
				displayOptions: {
					show: {
						resource: ['list'],
						operation: ['create'],
					},
				},
				description:
					'Comma-separated phone numbers in E.164 format to add to the new list. Contacts are created for any that are not already known. Leave empty to create an empty list.',
			},
			{
				displayName: 'Emails',
				name: 'seedEmails',
				type: 'string',
				default: '',
				placeholder: 'a@example.com, b@example.com',
				displayOptions: {
					show: {
						resource: ['list'],
						operation: ['create'],
					},
				},
				description: 'Comma-separated email addresses to add to the new list',
			},
		],
	};

	methods = {
		loadOptions: {
			async getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await getInboxes(this);
			},
			async getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await getLists(this);
			},
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await getTemplates(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const phoneNumber = this.getNodeParameter('phoneNumber', i, '') as string;

				let responseData: IDataObject;

				if (resource === 'message') {
					const inboxId = Number(this.getNodeParameter('inboxId', i));

					responseData =
						operation === 'send'
							? await sendMessage(this, {
									inboxId,
									phoneNumber,
									text: this.getNodeParameter('text', i) as string,
								})
							: await sendTemplateMessage(this, {
									inboxId,
									phoneNumber,
									templateId: Number(this.getNodeParameter('templateId', i)),
								});
				} else if (resource === 'contact') {
					const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;

					responseData = await createOrUpdateContact(this, {
						phoneNumber,
						firstName: additionalFields.firstName as string | undefined,
						lastName: additionalFields.lastName as string | undefined,
						email: additionalFields.email as string | undefined,
						note: additionalFields.note as string | undefined,
						custom: collectCustomFields(additionalFields),
					});
				} else if (resource === 'list') {
					if (operation === 'create') {
						responseData = await createList(this, {
							title: this.getNodeParameter('title', i) as string,
							phones: splitCsv(this.getNodeParameter('seedPhones', i, '') as string),
							emails: splitCsv(this.getNodeParameter('seedEmails', i, '') as string),
						});
					} else {
						// Mapped explicitly rather than with a ternary: treating any
						// unexpected operation as "remove" would make a wrong value
						// silently destructive.
						let action: ListMemberAction;
						if (operation === 'addContact') {
							action = 'add';
						} else if (operation === 'removeContact') {
							action = 'remove';
						} else {
							throw new NodeOperationError(
								this.getNode(),
								`Unsupported list operation "${operation}"`,
								{ itemIndex: i },
							);
						}

						responseData = await updateListMembership(
							this,
							Number(this.getNodeParameter('listId', i)),
							action,
							phoneNumber,
						);
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The resource "${resource}" is not supported`,
						{ itemIndex: i },
					);
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}

				throw interpretError(this, error, i);
			}
		}

		return [returnData];
	}
}
