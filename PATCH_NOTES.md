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

# v22.1 — fixes after audit of the delivered archive

## Fixed
- `dashboard.html`, `owner.html`, `report.html`: inline script had a `SyntaxError` (CSV export line `lines.join('\r\n')` / `'\uFEFF'` had been written as a literal newline and BOM), so these pages did not run at all. The owner/admin code is now a real source file, `js/page-owner.js`, and the three pages are thin shells (4 KB instead of ~400 KB each; `owner.html` and `dashboard.html` were byte-identical copies). They now load `app.js`, so the PIN gate works on them. Styles live in `css/owner.css`.
- `barista.html` was a stale 400 KB bundle; it is now the same page as `index.html`.
- Auth bypass removed: `js/page-admin.js` silently created an admin session on every load and reset the PIN brute-force limiter; `isPinAuthorized` in `js/sync.js` granted admin when the admin DOM was present or when `localStorage.coffee_active_barista` was set.
- `sw.js`: precache includes `css/owner.css` and `js/page-owner.js`; cache name bumped to `v22.1`.

## Verification
- All tests in `tests/` pass (19 unit, 6 contract/GAS, 12 e2e, transport runtime).
- All six HTML pages load in jsdom with no script errors; owner/admin pages show the PIN gate when unauthenticated, and all three owner sections render after login.

## Still open (unchanged)
Default PIN fallbacks in `Code.gs` / `js/security.js`, server-issued staff sessions, live GAS/Spreadsheet acceptance tests, and a signed-off financial model. See `DEPLOYMENT_MIGRATION_V22.md`.
