'use strict';
// Runtime smoke tests for shared POST transport and offline outbox.
require('./unit-tests.js');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
(async () => {
  const storage = global.localStorage;
  storage.removeItem('coffee_api_outbox_v1');
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'VALIDATION_FAILED' }) });
    const rejected = await window.coffeeFetch('https://example.test/api', {
      method: 'POST', body: JSON.stringify({ action: 'submit_cash', date: '2099-01-01', cash: 100, card: 0 })
    });
    assert(rejected.ok === false && rejected.confirmed === false, 'explicit server rejection must not become success');

    global.fetch = async () => { throw new Error('offline'); };
    const offline = await window.coffeeFetch('https://example.test/api', {
      method: 'POST', body: JSON.stringify({ action: 'submit_cash', date: '2099-01-02', cash: 200, card: 0 })
    });
    assert(offline.ok === true && offline.pending === true && offline.confirmed === false, 'offline result must be marked pending');
    assert(window.coffeeGetOutboxStatus().pending === 1, 'offline operation must remain in outbox');

    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, saved: true }) });
    const flushed = await window.coffeeFlushOutbox();
    assert(flushed.sent === 1 && flushed.pending === 0, 'outbox must clear only after server confirmation');
    assert(window.coffeeGetOutboxStatus().pending === 0, 'outbox status must report empty after confirmation');
    process.stdout.write('[PASS] POST rejects server errors, queues offline writes, flushes after server confirmation\n');
    process.exit(0);
  } finally {
    global.fetch = originalFetch;
  }
})().catch((e) => { process.stderr.write('[FAIL] ' + e.message + '\n'); process.exit(1); });
