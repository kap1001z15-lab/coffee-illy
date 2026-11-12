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

    // Временная ошибка сервера (например, старая версия скрипта) НЕ должна терять правку: очередь + автоповтор.
    storage.removeItem('coffee_api_outbox_v1');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'UNKNOWN_ACTION' }) });
    const soft = await window.coffeeFetch('https://example.test/api', { method: 'POST', body: JSON.stringify({ action: 'submit_cash', date: '2099-01-03', cash: 1, card: 0 }) });
    assert(soft.ok === true && soft.pending === true && soft.confirmed === false, 'transient server error must be queued, not local-only');
    assert(window.coffeeGetOutboxStatus().pending === 1, 'transient error operation must be in outbox');
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const flushed2 = await window.coffeeFlushOutbox(true);
    assert(flushed2.sent === 1 && flushed2.pending === 0, 'queued operation must be delivered once server accepts');

    // Безнадёжная (VALIDATION_FAILED) операция не блокирует остальные.
    storage.removeItem('coffee_api_outbox_v1'); storage.removeItem('coffee_api_outbox_failed_v1');
    const mk = (id, action) => ({ operationId: id, url: 'https://example.test/api', payload: { action, operationId: id }, createdAt: Date.now(), attempts: 0 });
    storage.setItem('coffee_api_outbox_v1', JSON.stringify([mk('bad1', 'submit_cash'), mk('good1', 'submit_cash')]));
    global.fetch = async (u, o) => { const b = JSON.parse(o.body); return { ok: true, status: 200, json: async () => (b.operationId === 'bad1' ? { ok: false, error: 'VALIDATION_FAILED' } : { ok: true }) }; };
    const flushed3 = await window.coffeeFlushOutbox(true);
    assert(flushed3.sent === 1 && flushed3.pending === 0 && window.coffeeGetOutboxStatus().failed === 1, 'invalid operation must be parked, valid one delivered');
    process.stdout.write('[PASS] POST rejects server errors, queues offline writes, flushes after server confirmation; transient errors retried; invalid ops do not block queue\n');
    process.exit(0);
  } finally {
    global.fetch = originalFetch;
  }
})().catch((e) => { process.stderr.write('[FAIL] ' + e.message + '\n'); process.exit(1); });
