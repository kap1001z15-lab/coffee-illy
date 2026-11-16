'use strict';
// Контрактные проверки связности frontend <-> GAS. Не заменяют запуск на реальном deployment.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; process.stdout.write('[PASS] ' + name + '\n'); }
  catch (e) { process.stderr.write('[FAIL] ' + name + ': ' + e.message + '\n'); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }

const sync = read('js/sync.js');
const gas = read('Code.gs');
const pages = ['js/page-terminal.js', 'js/page-admin.js', 'js/page-owner.js'].map(read).join('\n');

check('POST transport waits for server response and validates JSON contract', () => {
  if (!/const result = await _sendCorsSafePost\(url, operation/.test(sync)) throw new Error('coffeeFetch does not await server transport');
  if (!/typeof data\.ok !== 'boolean'/.test(sync)) throw new Error('server response contract is not validated');
  if (/return \{ ok: true, local: true \};/.test(sync)) throw new Error('legacy unconditional local success remains');
});
check('Offline mutations are stored in a persistent outbox with operation IDs', () => {
  ['coffee_api_outbox_v1', 'operationId', 'coffeeFlushOutbox', 'OUTBOX_FULL'].forEach((token) => {
    if (!sync.includes(token)) throw new Error('missing ' + token);
  });
});
check('GAS has server-side idempotency lookup and persistent operation journal', () => {
  ['getIdempotentResult_', 'idempotentJsonOut_', 'API_OPERATIONS', 'operationId'].forEach((token) => {
    if (!gas.includes(token)) throw new Error('missing ' + token);
  });
});
check('All UI modules use the shared coffeeFetch transport (owner goes through shared call())', () => {
  ['page-terminal.js', 'page-admin.js'].forEach((file) => {
    if (!read('js/' + file).includes('coffeeFetch(')) throw new Error(file + ' bypasses shared transport');
  });
});
check('Server returns explicit failure for unknown API actions', () => {
  if (!/UNKNOWN_ACTION: Неизвестное действие API/.test(gas)) throw new Error('unknown action is not rejected');
});
check('PIN is no longer copied from system task responsible field into local admin PIN', () => {
  if (/if \(t\.responsible\) syncPin = String\(t\.responsible\)/.test(sync)) throw new Error('legacy PIN extraction remains');
});

process.stdout.write(`\nИТОГО КОНТРАКТНЫХ ПРОВЕРОК: ${passed}/6 успешно.\n`);
