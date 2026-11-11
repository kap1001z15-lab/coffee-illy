# Patch notes — v22 foundation refactor

## Changed

- `coffeeFetch` POST now waits for the Apps Script response and accepts success only for a valid JSON response with `ok: true`.
- Explicit server errors are returned as errors; local state is not falsely marked as confirmed.
- Offline/ambiguous writes receive a stable `operationId`, are stored in a FIFO local outbox, and are applied locally with an explicit `pending` marker.
- Outbox retry runs when the browser fires the `online` event; queued operations are removed only after server confirmation.
- Queue capacity is capped at 250; when full, a new offline write is rejected rather than dropping existing queued work.
- Apps Script now checks `operationId` before dispatch and stores confirmed results in `API_OPERATIONS` plus `CacheService`.
- Legacy cloud-sync writer was removed. The legacy `CLOUD_SYNC_V17` envelope remains readable for backward compatibility.
- Removed extraction of a supposed PIN from the system task `responsible` field.
- Added contract and runtime tests for the shared transport and offline queue.

## Verification

- `node tests/unit-tests.js` — 18/18 passed.
- `node tests/integration-contract-tests.js` — 6/6 passed.
- `node tests/transport-runtime-tests.js` — passed.
- `node --check` for frontend JavaScript and the Apps Script source (copied to `.js`) — passed.

## Not included / still required

This is not a complete rewrite of every business module. Default PIN fallbacks, staff server sessions, real media storage, complete financial model, and live GAS/Spreadsheet acceptance tests remain outstanding. See `ARCHITECTURE_V22.md` and `DEPLOYMENT_MIGRATION_V22.md`.
