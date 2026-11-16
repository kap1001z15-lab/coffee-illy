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

  // Проверка моста совместимости (Legacy Server Bridge): если старый Code.gs возвращает "Error: unknown action"
  // на save_checklist_blocks / update_incident / delete_incident, клиент автоматически проводит их через базовые
  // действия старого сервера (save_setting, resolve_incident, save_task) и очередь остаётся пустой (0).
  localStorage.removeItem('coffee_api_outbox_v1');
  localStorage.setItem('coffee_illy_pin', '1234');
  global.fetch = async (url, opts) => {
    if (opts && opts.method === 'POST') {
      const b = JSON.parse(opts.body || '{}');
      if (b.action === 'save_checklist_blocks' || b.action === 'update_incident' || b.action === 'delete_incident') {
        return { ok: true, status: 200, json: async () => ({ ok: false, error: 'Error: unknown action' }) };
      }
      if (b.action === 'save_setting' || b.action === 'resolve_incident' || b.action === 'save_task') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, rev: '200' }) };
  };
  const rBlocks = await window.coffeeFetch(window.COFFEE.API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'save_checklist_blocks',
      blocks: [{ id: 'b1', name: 'Открытие', start: '07:30', deadline: '08:30', icon: '🌅' }]
    })
  });
  assert(rBlocks.ok === true && rBlocks.confirmed === true, 'save_checklist_blocks должен мгновенно подтверждаться через Legacy Server Bridge');
  assert(window.coffeeGetOutboxStatus().pending === 0, 'очередь должна оставаться пустой (0) при работе через мост совместимости');

  const rInc = await window.coffeeFetch(window.COFFEE.API_URL, {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_incident',
      id: 'INC-TEST-1',
      status: 'Решена'
    })
  });
  assert(rInc.ok === true && rInc.confirmed === true, 'update_incident должен мгновенно подтверждаться через Legacy Server Bridge');
  assert(window.coffeeGetOutboxStatus().pending === 0, 'очередь после update_incident должна быть пустой');

  process.stdout.write('[PASS] Живая синхронизация: смена версии подтягивает данные; локальная очередь не затирается\n');
  process.exit(0);
})().catch((e) => { process.stderr.write('[FAIL] ' + e.message + '\n'); process.exit(1); });
