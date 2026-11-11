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
const pages = ['js/page-terminal.js', 'js/page-admin.js', 'js/page-dashboard.js', 'js/page-report.js'].map(read).join('\n');
const security = read('js/security.js');
const ownerHtml = read('owner.html');
const baristaHtml = read('barista.html');

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
check('All four UI modules use the shared coffeeFetch transport', () => {
  ['page-terminal.js', 'page-admin.js', 'page-dashboard.js', 'page-report.js'].forEach((file) => {
    if (!read('js/' + file).includes('coffeeFetch(')) throw new Error(file + ' bypasses shared transport');
  });
});
check('Server returns explicit failure for unknown API actions', () => {
  if (!/UNKNOWN_ACTION: Неизвестное действие API/.test(gas)) throw new Error('unknown action is not rejected');
});
check('PIN is no longer copied from system task responsible field into local admin PIN', () => {
  if (/if \(t\.responsible\) syncPin = String\(t\.responsible\)/.test(sync)) throw new Error('legacy PIN extraction remains');
});

check('Staff write endpoints require server-issued staff sessions and bind identity to session', () => {
  ['submit_checklist', 'submit_cash', 'batch_submit_cash', 'upload_photo', 'ack_announcement', 'report_standalone_incident'].forEach((action) => {
    const i = gas.indexOf("action === '" + action + "'");
    if (i < 0 || !gas.slice(i, i + 500).includes('resolveVerifiedStaffSession_')) throw new Error(action + ' is not guarded by staff session');
  });
  if (!/STAFF_SESSION_REQUIRED/.test(gas) || !/body\.userName = sess\.staffName/.test(gas)) throw new Error('staff session does not enforce session identity');
});
check('Online owner and staff login await server authentication', () => {
  if (!/const response = await fetch\(apiUrl/.test(security)) throw new Error('login does not await server response');
  if (!/serverAuthenticated: true/.test(security)) throw new Error('server-authenticated session marker missing');
  if (!/async loginStaff/.test(security)) throw new Error('staff login is not asynchronous');
});
check('Owner-facing GET requests use sessionToken instead of PIN query strings', () => {
  ['js/page-admin.js', 'js/page-dashboard.js', 'js/page-report.js'].forEach((file) => {
    if (/\&pin=/.test(read(file))) throw new Error(file + ' still sends PIN in URL');
    if (!/sessionToken/.test(read(file))) throw new Error(file + ' does not send sessionToken');
  });
  if (/\?action=(admin|dashboard).*\&pin=/.test(ownerHtml)) throw new Error('owner.html still sends PIN in URL');
});
check('Owner page no longer creates an admin session automatically; barista modal uses server login', () => {
  if (/createLocalSession\('admin', 'Администратор', expectedHash\)/.test(ownerHtml)) throw new Error('automatic owner session remains');
  if (!/await window\.coffeeAuth\.loginStaff\(targetName, entered\)/.test(baristaHtml)) throw new Error('barista PIN modal bypasses server login');
});
check('Offline outbox rebinds local tokens only after the same user authenticates online', () => {
  if (!sync.includes("indexOf('st_local_') === 0")) throw new Error('local session tokens are not detected');
  if (!sync.includes('activeSession.role === \'staff\'') || !sync.includes('activeSession.staffName')) throw new Error('staff identity matching missing');
  if (!sync.includes('sameAdmin')) throw new Error('admin outbox re-authentication missing');
});

process.stdout.write(`\nИТОГО КОНТРАКТНЫХ ПРОВЕРОК: ${passed}/11 успешно.\n`);
