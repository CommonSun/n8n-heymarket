# Changelog

All notable changes to this package are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-09

### Fixed

- Codex `node` field for both nodes now uses the `n8n-nodes-heymarket.` package
  prefix instead of `n8n-nodes-base.`, as required for community nodes.

## [0.1.0] - 2026-09-25

### Added

- Heymarket node with Message (Send Custom Message, Send Template Message),
  Contact (Create or Update Contact), and List (Add Contact to List, Create
  List, Remove Contact From List) operations.
- Heymarket Trigger node covering Incoming Message, Outgoing Message, Opt-Out
  Received, Incoming Call, Chat Started (Inbound), Chat Started (Outbound), and
  New or Updated Contact.
- Heymarket API credential with a connection test that reports which team a key
  belongs to.
