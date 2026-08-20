# n8n-nodes-heymarket

An [n8n](https://n8n.io) community node for [Heymarket](https://www.heymarket.com) business
texting. Send SMS and MMS from a workflow, keep contacts and lists in sync, and start workflows
from inbound messages, calls, and opt-outs.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) ·
[Triggers](#triggers) · [Example workflows](#example-workflows) · [Things worth knowing](#things-worth-knowing)

## Installation

### On n8n Cloud

Search for **Heymarket** in the nodes panel and add it to your workflow.

### On self-hosted n8n

Go to **Settings → Community Nodes → Install**, enter `n8n-nodes-heymarket`, and confirm.

Or install manually in your n8n data directory:

```bash
npm install n8n-nodes-heymarket
```

## Credentials

You authenticate with a Heymarket API key that is specific to n8n.

1. In Heymarket, open **Manage Integrations** and generate an **n8n API key**. You need to be an
   owner or admin of the account.
2. Copy the key. **It is shown once and cannot be retrieved again** — if you lose it, generate a
   new one, which invalidates the old.
3. In n8n, create a new **Heymarket API** credential and paste the key.
4. Save. n8n checks the key immediately and shows which Heymarket team it belongs to. Name the
   credential after that team, especially if you plan to connect more than one.

**Base URL** should be left at `https://api.heymarket.com` unless Heymarket support asks you to
change it.

A key belongs to exactly one Heymarket team. To work with several teams, create one credential per
team and pick the right one on each node. Note that n8n does not allow choosing a credential with
an expression, so routing an item to a different team at runtime means a **Switch** node with one
branch per team.

A Heymarket **Zapier** key will not work here. The two are independent, so revoking one does not
affect the other.

## Operations

### Message

- **Send** — send a message with text you provide
- **Send Template** — send a message built from a saved Heymarket template, with merge fields
  filled in by Heymarket

Both take an inbox and a recipient phone number in E.164 format, for example `+15005550001`.

### Contact

- **Create or Update** — create a contact, or update the existing one when the phone number is
  already known

Optional fields are only sent when you fill them in, so leaving a box empty never clears a value
already stored in Heymarket. Custom fields are picked from a dropdown of the fields configured on
your Heymarket account, so there is no field name to type by hand. Fields with no name set are not
offered, and where two fields share a name only one entry appears.

### List

- **Add Contact** — add a contact to a list
- **Remove Contact** — remove a contact from a list

## Triggers

The **Heymarket Trigger** node starts a workflow when one of these happens:

| Event | Fires when |
| --- | --- |
| Message Received | A contact sends a message |
| Message Sent | A team member sends a message |
| Opt-Out Received | A contact replies with an opt-out keyword |
| Incoming Call | An inbound phone call is received |
| Chat Started (Inbound) | A contact starts a new conversation |
| Chat Started (Outbound) | A team member starts a new conversation |
| Contact Updated | A contact is created or changed |

Every event except **Contact Updated** is scoped to one or more inboxes, which you select on the
node. Contact Updated applies to the whole account, because contacts do not belong to an inbox.

Subscriptions are created when you **activate** the workflow and removed when you **deactivate**
it.

## Example workflows

**Auto-reply to an inbound message**

```
Heymarket Trigger (Message Received)
  → IF (message contains "hours")
    → Heymarket (Message → Send Template: "Business Hours")
```

**Send a text when a deal closes in your CRM**

```
CRM Trigger (Deal won)
  → Heymarket (Contact → Create or Update)
  → Heymarket (Message → Send)
```

**Keep an onboarding list in sync**

```
Schedule Trigger (daily)
  → HTTP Request (fetch new signups)
  → Heymarket (Contact → Create or Update)
  → Heymarket (List → Add Contact)
```

**Handle opt-outs in your own systems**

```
Heymarket Trigger (Opt-Out Received)
  → HTTP Request (mark unsubscribed in your CRM)
```

## Things worth knowing

**Webhook URLs must be publicly reachable over HTTPS.** Heymarket refuses to deliver to private,
loopback, or link-local addresses. For local development, run `n8n start --tunnel` or use an n8n
instance on a real domain.

**A successful send means accepted, not delivered.** The node returns as soon as Heymarket accepts
the message and queues it with the carrier. Carrier-level delivery failures happen after that and
are not reported back to the workflow.

**Messages sent by integrations do not fire the Message Sent trigger.** That includes messages this
node sends, which means a workflow that both watches Message Sent and sends messages will not
trigger itself. It also means such a workflow cannot observe traffic from other integrations.

**Opt-outs stop a send.** Sending to a contact who has opted out fails the item rather than
silently discarding it. Turn on **Continue On Fail** if you want the rest of a batch to proceed.

**Make trigger workflows idempotent.** Delivery is at-most-once, but a retry on your side or a
duplicate inbound event should not double-process.

**Archived and private lists and templates do not appear in the dropdowns.**

**Deactivate before deleting.** n8n only removes Heymarket subscriptions when a workflow is
deactivated. Deleting an active workflow outright leaves the subscription in place for a while.

## Compatibility

Requires n8n 1.x and Node.js 20.15 or later.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Heymarket](https://www.heymarket.com)

## Development

```bash
npm install
npm run dev     # runs n8n with this node loaded, rebuilding on change
npm run lint    # n8n's community-node lint rules
npm test        # unit tests
npm run build   # compile to dist/
```

## License

[MIT](LICENSE.md)
