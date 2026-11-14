> **Актуальный статус релиза: v65 (14.11.2026)** — синхронизировано с `version.js`, `Code.gs` (`api: 2, serverVersion: 'v65'`) и `PATCH_NOTES.md`.

# Coffee Management System — Architecture v22 foundation

## Scope of this release

This release is a compatibility-preserving foundation refactor. Existing HTML pages, CSS, business modules, spreadsheet-backed records, and the current Apps Script API actions are retained. It does **not** claim that every business module has been rewritten or that the live deployment has been integration-tested.

## Request lifecycle

1. A page calls the shared `coffeeFetch` adapter.
2. For POST requests, the adapter validates the request JSON, adds a stable `operationId`, and attaches the current server session token when available.
3. The adapter sends `text/plain` JSON to the deployed Apps Script endpoint. This avoids a browser preflight request for the normal GAS web-app flow.
4. The adapter accepts success only when the response is valid JSON and explicitly contains `ok: true`.
5. Only after server confirmation is the local owner vault updated as a confirmed mutation.
6. If the network fails or the response is ambiguous, the operation is placed in `coffee_api_outbox_v1`, applied locally as pending, and retried in FIFO order after the browser returns online.
7. Explicit server rejection is returned as an error and is not represented as a successful write.

## Idempotency

Every shared POST operation receives an `operationId`. Apps Script checks the operation journal before dispatch. Confirmed results are recorded in the `API_OPERATIONS` sheet and cached in `CacheService`. Repeated delivery with the same ID returns the previous result rather than executing the action again.

The journal is capped to the latest 5,000 successful operations. The script lock serializes the lookup, action, and journal write. This materially reduces duplicate writes after a timeout/retry. It is not a database transaction: a process termination between the business write and journal append remains a narrow residual risk and must be covered by live acceptance tests.

## Offline queue semantics

- Queue key: `coffee_api_outbox_v1` in browser localStorage.
- Maximum queued operations: 250. When full, the app rejects a new offline write rather than silently dropping an older operation.
- Operations are sent FIFO and removed only after explicit server confirmation.
- A server-side rejection blocks the queue and is exposed by `coffeeGetOutboxStatus()`; this preserves ordering instead of silently skipping an invalid operation.
- The browser emits `outbox_synced` and `outbox_error` events.

## Backward compatibility and data

- Existing HTML and CSS are unchanged.
- Existing Google Sheets business tabs are not migrated or rewritten by this patch.
- `API_OPERATIONS` is a new technical sheet created automatically on the first POST carrying an operation ID.
- Legacy `CLOUD_SYNC_V17` remains readable. Its old writer was removed from the client so it cannot continue writing the PIN into the system task's `responsible` field. New writes use the existing explicit API actions.
- Existing IndexedDB and localStorage databases are retained; the offline outbox uses a separate versioned key.

## Known limitations / production blockers

1. The repository still contains default PIN fallbacks (including `1234`, `1111`, etc.). These must be removed through a deliberate first-run credential migration; deleting them blindly can lock out an existing installation.
2. Staff-facing public operations still identify the operator using client-supplied fields. A dedicated server-issued staff session and server-side role policy are still required.
3. Photo/video server storage remains unimplemented; `upload_photo` correctly returns an explicit error rather than a false success.
4. The old client-side local session signature is not a security boundary. Authorization must be enforced by Apps Script for every protected action.
5. No live Google Spreadsheet, deployed GAS endpoint, Telegram bot, or multi-device production environment was available for this build. The Apps Script runtime and real permissions must be tested after deployment.
6. Financial definitions (COGS, payroll accrual, taxes/fees, owner net profit, CAC) still require a signed-off business data model before being treated as accounting truth.

## Verification performed locally

- Existing unit tests: 18/18 pass.
- Frontend/GAS contract checks: 6/6 pass.
- Runtime transport tests: server rejection, offline queue, and confirmed flush pass.
- JavaScript syntax checks: pass.
- `Code.gs` parsed as JavaScript with Node's syntax parser; this is not a substitute for Google Apps Script execution.
