import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'heymarketApi';

const API_BASE_PATH = '/n8n/v1';
const DRY_RUN_HEADER = 'X-Heymarket-Dry-Run';

const DEFAULT_BASE_URL = 'https://api.heymarket.com';

/**
 * Error codes worth retrying. Everything else is a request the caller has to
 * change, so retrying it only burns executions.
 */
const RETRYABLE_ERROR_CODES = new Set(['internal_error', 'rate_limited']);

/**
 * Messages that read better than the raw API text in the n8n UI. The API's own
 * `message` field is human-readable but may be reworded server-side, so it is
 * never parsed — only these codes are.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
	invalid_api_key:
		'The Heymarket API key was not accepted. Check the credential, and note that a Zapier key will not work here.',
	missing_api_key: 'No Heymarket API key was sent. Reopen the credential and save it again.',
	unsubscribed_number: 'This contact has opted out of messages from this inbox.',
	no_sender_available:
		'No user on this inbox is able to send messages, so Heymarket could not attribute the message to anyone.',
};

export type HeymarketContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

export interface HeymarketNamedOption {
	id: number;
	name: string;
}

export interface HeymarketTestAuthResponse {
	team_id: number;
	team_name: string;
}

export interface HeymarketTriggerResponse {
	id: string;
}

export interface HeymarketApiErrorBody {
	error_code?: string;
	message?: string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Performs a request against the Heymarket n8n API and returns the parsed body.
 *
 * The credential injects `X-Heymarket-API-Key`, so the request must go through
 * `httpRequestWithAuthentication` — a plain `httpRequest` would be unauthenticated
 * and would also pull the key into node code.
 */
export async function heymarketApiRequest(
	context: HeymarketContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	forceReal = false,
): Promise<unknown> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const baseUrl = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).replace(/\/+$/, '');

	const headers = isDryRun(context, forceReal) ? { [DRY_RUN_HEADER]: 'true' } : undefined;

	return await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_NAME, {
		method,
		url: `${baseUrl}${API_BASE_PATH}${endpoint}`,
		headers,
		body,
		json: true,
	});
}

/**
 * True when the run was started from the editor and the user has not asked for real
 * actions. Heymarket then validates the request and returns without performing it.
 *
 * Only `manual` counts. `retry` is excluded deliberately: retrying a failed
 * production execution must do real work, at the cost of a retried manual run
 * performing the operation. `evaluation`, `chat` and `agent` are production-like
 * paths and are likewise treated as real.
 *
 * `getMode` is optional on the base context type, so a context without it -- which
 * cannot reach a write endpoint anyway -- falls through to a real request.
 */
function isDryRun(context: HeymarketContext, forceReal: boolean): boolean {
	if (forceReal) return false;

	const mode = (context as { getMode?: () => string }).getMode?.();
	return mode === 'manual';
}

// ---------------------------------------------------------------------------
// Dropdown sources
// ---------------------------------------------------------------------------

/**
 * Fetches a `{ id, name }` list and maps it into the `{ name, value }` shape n8n
 * expects for a dropdown. This mapping is the only place the two vocabularies meet.
 */
export async function loadNamedOptions(
	context: ILoadOptionsFunctions,
	endpoint: string,
): Promise<INodePropertyOptions[]> {
	const rows = (await heymarketApiRequest(context, 'GET', endpoint)) as HeymarketNamedOption[];

	if (!Array.isArray(rows)) {
		return [];
	}

	return rows.map((row) => ({ name: row.name, value: row.id }));
}

export async function getInboxes(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await loadNamedOptions(context, '/inboxes');
}

export async function getLists(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return await loadNamedOptions(context, '/lists');
}

export async function getTemplates(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await loadNamedOptions(context, '/templates');
}

/**
 * Fetches custom contact fields as `{ name, value }` where the value is the field
 * ID as a string.
 *
 * Heymarket stores custom fields keyed by field ID and validates incoming keys
 * against the team's field IDs, so a title-keyed payload is accepted with a 200 and
 * then silently discarded. The ID is stringified because it becomes an object key
 * in the `custom` map.
 */
export async function getContactFields(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const rows = (await heymarketApiRequest(
		context,
		'GET',
		'/contact_fields',
	)) as HeymarketNamedOption[];

	if (!Array.isArray(rows)) {
		return [];
	}

	return rows.map((row) => ({ name: row.name, value: String(row.id) }));
}

// ---------------------------------------------------------------------------
// Resource operations
//
// Every function below is the single place a Heymarket field name appears. Node
// files pass camelCase and receive the raw response body; the snake_case mapping
// lives here so a contract change is a one-file edit. Responses are returned
// whole rather than reshaped, so a field added server-side reaches the workflow
// without a release of this package.
// ---------------------------------------------------------------------------

export interface SendMessageOptions {
	inboxId: number;
	phoneNumber: string;
	text: string;
}

export interface SendTemplateOptions {
	inboxId: number;
	phoneNumber: string;
	templateId: number;
}

export interface ContactOptions {
	phoneNumber: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	note?: string;
	custom?: Record<string, string>;
}

export type ListMemberAction = 'add' | 'remove';

export interface CreateListOptions {
	title: string;
	phones?: string[];
	emails?: string[];
}

/** Sends a message with caller-provided text. */
export async function sendMessage(
	context: HeymarketContext,
	options: SendMessageOptions,
	forceReal = false,
): Promise<IDataObject> {
	return (await heymarketApiRequest(
		context,
		'POST',
		'/messages',
		{
			inbox_id: options.inboxId,
			phone_number: options.phoneNumber,
			text: options.text,
		},
		forceReal,
	)) as IDataObject;
}

/** Sends a message built from a saved template. Merge fields are filled server-side. */
export async function sendTemplateMessage(
	context: HeymarketContext,
	options: SendTemplateOptions,
	forceReal = false,
): Promise<IDataObject> {
	return (await heymarketApiRequest(
		context,
		'POST',
		'/messages',
		{
			inbox_id: options.inboxId,
			phone_number: options.phoneNumber,
			template_id: options.templateId,
		},
		forceReal,
	)) as IDataObject;
}

/**
 * Creates a contact, or updates the existing one when the phone number already
 * exists. Optional fields are omitted rather than sent empty, so leaving a field
 * blank never clears a value already stored in Heymarket.
 */
export async function createOrUpdateContact(
	context: HeymarketContext,
	options: ContactOptions,
	forceReal = false,
): Promise<IDataObject> {
	const body: IDataObject = { phone_number: options.phoneNumber };

	if (options.firstName) body.first_name = options.firstName;
	if (options.lastName) body.last_name = options.lastName;
	if (options.email) body.email = options.email;
	if (options.note) body.note = options.note;
	if (options.custom && Object.keys(options.custom).length > 0) body.custom = options.custom;

	return (await heymarketApiRequest(context, 'POST', '/contacts', body, forceReal)) as IDataObject;
}

/**
 * Creates a list, optionally seeded with phone numbers and email addresses.
 * Contacts are created server-side for any that are not already known, so this is
 * one call rather than a create followed by a loop.
 */
export async function createList(
	context: HeymarketContext,
	options: CreateListOptions,
	forceReal = false,
): Promise<IDataObject> {
	const body: IDataObject = { title: options.title };

	if (options.phones?.length) body.phones = options.phones;
	if (options.emails?.length) body.emails = options.emails;

	return (await heymarketApiRequest(context, 'POST', '/lists', body, forceReal)) as IDataObject;
}

/** Adds or removes one contact on a list, addressed by phone number. */
export async function updateListMembership(
	context: HeymarketContext,
	listId: number,
	action: ListMemberAction,
	phoneNumber: string,
	forceReal = false,
): Promise<IDataObject> {
	return (await heymarketApiRequest(
		context,
		'POST',
		`/lists/${listId}/members`,
		{
			action,
			phone_number: phoneNumber,
		},
		forceReal,
	)) as IDataObject;
}

// ---------------------------------------------------------------------------
// Trigger subscriptions
// ---------------------------------------------------------------------------

/** Subscribes a webhook URL to one event, optionally scoped to a single inbox. */
export async function createTrigger(
	context: HeymarketContext,
	event: string,
	url: string,
	sendSample: boolean,
	inboxId?: number,
): Promise<HeymarketTriggerResponse> {
	const body: IDataObject = { event, url, send_sample: sendSample };

	if (inboxId !== undefined) body.inbox_id = inboxId;

	return (await heymarketApiRequest(
		context,
		'POST',
		'/triggers',
		body,
	)) as HeymarketTriggerResponse;
}

/** Removes one webhook subscription. */
export async function deleteTrigger(context: HeymarketContext, hookId: string): Promise<void> {
	await heymarketApiRequest(context, 'DELETE', `/triggers/${hookId}`);
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Reads `error_code` off a failed Heymarket response. Returns an empty string when
 * the failure did not come from the API (network error, proxy HTML, timeout).
 */
export function extractErrorCode(error: unknown): string {
	const candidates: unknown[] = [
		(error as { response?: { body?: unknown } })?.response?.body,
		(error as { response?: { data?: unknown } })?.response?.data,
		(error as { error?: unknown })?.error,
		(error as { cause?: { error?: unknown } })?.cause?.error,
	];

	for (const candidate of candidates) {
		if (candidate && typeof candidate === 'object') {
			const code = (candidate as HeymarketApiErrorBody).error_code;
			if (typeof code === 'string' && code !== '') {
				return code;
			}
		}
	}

	return '';
}

/**
 * Converts a failed request into the right n8n error class.
 *
 * The distinction is load-bearing: `NodeApiError` lets n8n retry, which is correct
 * for a transient server fault, while `NodeOperationError` does not, which is
 * correct for a request that will fail identically forever.
 */
export function interpretError(
	context: HeymarketContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	const errorCode = extractErrorCode(error);
	const node = context.getNode();
	const options = itemIndex === undefined ? {} : { itemIndex };
	const friendly = FRIENDLY_MESSAGES[errorCode];

	// No error_code means the request never reached the API, or something in front of
	// it answered. Treat it as retryable — the alternative is failing a workflow on a
	// dropped connection.
	if (errorCode === '' || RETRYABLE_ERROR_CODES.has(errorCode)) {
		return new NodeApiError(node, error as JsonObject, options);
	}

	return new NodeOperationError(node, friendly ?? (error as Error), {
		...options,
		description: friendly === undefined ? undefined : `Heymarket returned ${errorCode}`,
	});
}
