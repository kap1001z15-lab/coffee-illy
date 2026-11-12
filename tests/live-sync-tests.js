'use strict';
// Клиентская живая синхронизация: смена версии на сервере приводит к подтягиванию данных и событию server_sync{live:true}.
require('./unit-tests.js');
const assert = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  window.COFFEE = window.COFFEE || {}; window.COFFEE.API_URL = 'https://example.test/exec';
  let rev = '100'; let checklistCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.indexOf('action=get_rev') >= 0) return { ok: true, status: 200, json: async () => ({ ok: true, rev }) };
    if (u.indexOf('action=get_checklists') >= 0) { checklistCalls++; return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [], rev }) }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const events = [];
  window.coffeeBus.on((m) => { if (m.type === 'server_sync' && m.detail && m.detail.live) events.push(m); });
  localStorage.removeItem('coffee_api_outbox_v1');
  await window.coffeeLiveSyncNow();              // первый опрос запоминает версию (force => синхронизация)
  events.length = 0; const base = checklistCalls;
  await window.coffeeLiveSyncNow();
  rev = '100';
  // Без изменений версии (обычный тик) — ничего не подтягиваем
  const calls0 = checklistCalls;
  await window.coffeeLiveSyncState; // no-op
  assert(window.coffeeLiveSyncState.lastRev === '100', 'версия запомнена');
  // Другое устройство изменило данные
  rev = '101';
  window.coffeeLiveSyncState.lastRev = '100';
  await window.coffeeLiveSyncNow();
  assert(events.length >= 1 && events[events.length - 1].detail.rev === '101', 'смена версии должна породить live server_sync');
  assert(checklistCalls > calls0, 'при смене версии данные должны быть запрошены заново');
  // Свои неотправленные правки не затираются чужими данными
  localStorage.setItem('coffee_api_outbox_v1', JSON.stringify([{ operationId: 'x1', url: 'https://example.test/exec', payload: { action: 'x', operationId: 'x1' }, createdAt: Date.now(), attempts: 1, nextRetryAt: Date.now() + 60000 }]));
  const ev = events.length; rev = '102';
  await window.coffeeLiveSyncNow();
  assert(events.length === ev, 'пока есть неотправленные локальные правки, чужие данные не накатываются');
  process.stdout.write('[PASS] Живая синхронизация: смена версии подтягивает данные; локальная очередь не затирается\n');
  process.exit(0);
})().catch((e) => { process.stderr.write('[FAIL] ' + e.message + '\n'); process.exit(1); });
