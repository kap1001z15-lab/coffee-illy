/**
 * Автотесты безопасности, изоляции ролей и контрактов Coffee Illy v4.0
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const codeGsSrc = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Лёгкий mock среды Google Apps Script
const scriptProps = {};
const scriptCache = {};
const sheetsStore = {};

function makeSheet(name) {
  const sh = {
    _name: name,
    _rows: [],
    getName() { return name; },
    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
    appendRow(arr) { this._rows.push(arr.slice()); return this; },
    getDataRange() {
      const self = this;
      return {
        getValues() { return self._rows.map(r => r.slice()); },
        getDisplayValues() { return self._rows.map(r => r.map(v => String(v ?? ''))); }
      };
    },
    getRange(r, c, nr = 1, nc = 1) {
      const self = this;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = self._rows[r - 1 + i] || [];
            const slice = [];
            for (let j = 0; j < nc; j++) slice.push(row[c - 1 + j] ?? '');
            out.push(slice);
          }
          return out;
        },
        getValue() { return ((self._rows[r - 1] || [])[c - 1]) ?? ''; },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            while (self._rows.length < r + i) self._rows.push([]);
            for (let j = 0; j < vals[i].length; j++) {
              self._rows[r - 1 + i][c - 1 + j] = vals[i][j];
            }
          }
        },
        setValue(val) {
          while (self._rows.length < r) self._rows.push([]);
          self._rows[r - 1][c - 1] = val;
        },
        createTextFinder(q) {
          return {
            matchEntireCell() { return this; },
            findNext() {
              for (let i = 0; i < nr; i++) {
                const val = String(((self._rows[r - 1 + i] || [])[c - 1]) ?? '');
                if (val === String(q)) return { getRow() { return r + i; } };
              }
              return null;
            }
          };
        }
      };
    },
    deleteRows(start, count) { this._rows.splice(start - 1, count); }
  };
  return sh;
}

const ssMock = {
  getSheetByName(n) { return sheetsStore[n] || null; },
  insertSheet(n) { sheetsStore[n] = makeSheet(n); return sheetsStore[n]; },
  getSheets() { return Object.values(sheetsStore); }
};

const gasCtx = {
  console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
  SpreadsheetApp: { getActiveSpreadsheet: () => ssMock },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
      setProperty: (k, v) => { scriptProps[k] = String(v); },
      deleteProperty: (k) => { delete scriptProps[k]; },
      getProperties: () => Object.assign({}, scriptProps)
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get: (k) => (k in scriptCache ? scriptCache[k] : null),
      put: (k, v) => { scriptCache[k] = String(v); },
      remove: (k) => { delete scriptCache[k]; }
    })
  },
  LockService: {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (txt) => ({ _t: txt, setMimeType() { return this; }, getContent() { return this._t; } })
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_alg, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest().map(b => (b > 127 ? b - 256 : b))),
    formatDate: () => '12:00',
    base64Decode: (b) => Buffer.from(b, 'base64'),
    newBlob: (d, m, n) => ({ d, m, n })
  },
  Session: { getScriptTimeZone: () => 'Europe/Chisinau' },
  DriveApp: {
    getFoldersByName: () => ({ hasNext: () => false }),
    createFolder: () => ({ getId: () => 'fld_1', createFile: () => ({ getId: () => 'f_1', getUrl: () => 'https://drive.example/f_1' }) }),
    getFolderById: () => ({ createFile: () => ({ getId: () => 'f_1', getUrl: () => 'https://drive.example/f_1' }) })
  },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"ok":true}' }) }
};

vm.createContext(gasCtx);
vm.runInContext(codeGsSrc, gasCtx);

function callGet(params) {
  return JSON.parse(gasCtx.doGet({ parameter: params }).getContent());
}
function callPost(body) {
  return JSON.parse(gasCtx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
}

// Настройка учётных данных и сотрудников
gasCtx.ensureSheets_(ssMock);
callPost({ action: 'setup_initial_credentials', newAdminPin: '849261', staffPins: { 'Соня': '571923', 'Алина': '682041' } });
const adminLogin = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '849261' });
callPost({ action: 'save_staff', sessionToken: adminLogin.sessionToken, id: 'st_sonya', name: 'Соня', role: 'staff', active: 'да', pin: '571923' });
callPost({ action: 'save_staff', sessionToken: adminLogin.sessionToken, id: 'st_alina', name: 'Алина', role: 'staff', active: 'да', pin: '682041' });
callPost({ action: 'save_staff_pins', sessionToken: adminLogin.sessionToken, pins: { 'Соня': '571923', 'Алина': '682041' } });
delete scriptProps['PIN_CHANGE_REQUIRED_Соня'];
delete scriptProps['PIN_CHANGE_REQUIRED_Алина'];
const sonyaLogin = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '571923' });
const alinaLogin = callPost({ action: 'auth_login', role: 'staff', staffName: 'Алина', pin: '682041' });

let passed = 0;
function test(name, fn) {
  fn();
  console.log('[PASS] ' + name);
  passed++;
}

test('v4-1. get_rev не отдаёт env (LIVE_ENV_V63) при любом sinceRev', () => {
  scriptCache['LIVE_ENV_V63'] = JSON.stringify({ secretAdminCfg: 123 });
  const r = callGet({ action: 'get_rev', sinceRev: '0' });
  assert(r.ok === true && !('env' in r), 'get_rev не должен содержать env');
});

test('v4-2. Публичный get_checklists не раскрывает планы, черновики, чек-листы, tgId и финансы', () => {
  const pub = callGet({ action: 'get_checklists' });
  assert(pub.ok === true, 'get_checklists должен отвечать ok:true');
  const forbidden = ['plan', 'dailyPlans', 'minAvgCheck', 'planChecks', 'woNorm', 'userDrafts', 'userActiveState', 'personalTasksDone', 'checklists', 'deltas', 'ttk', 'settings', 'revenue', 'profit', 'cogs'];
  forbidden.forEach(k => assert(!(k in pub), 'Публичный get_checklists не должен содержать ' + k));
  (pub.staff || []).forEach(s => assert(!('tgId' in s), 'staff в публичном get_checklists не должен содержать tgId'));
});

test('v4-3. staff_bootstrap изолирует данные сотрудника и не содержит финансовых ключей', () => {
  // Алина сохраняет черновик и сдаёт чек-лист
  callPost({
    action: 'save_checklist_draft',
    sessionToken: alinaLogin.sessionToken,
    date: '2026-11-16',
    block: 'Открытие',
    draft: { date: '2026-11-16', userName: 'Алина', block: 'Открытие', idx: 2, answers: [] }
  });
  callPost({
    action: 'submit_checklist',
    sessionToken: alinaLogin.sessionToken,
    block: 'Открытие',
    items: [{ id: 'o1', title: 'Тест', isIncident: false }]
  });

  // Соня запрашивает staff_bootstrap — не видит черновиков и чек-листов Алины и не видит финансов
  const boot = callPost({ action: 'staff_bootstrap', sessionToken: sonyaLogin.sessionToken });
  assert(boot.ok === true, 'staff_bootstrap должен работать по staff sessionToken');
  const jsonStr = JSON.stringify(boot);
  ['dailyPlans', 'minAvgCheck', 'planChecks', 'woNorm', 'profit', 'revenue', 'cogs', 'foodCost', 'margin', 'tgId'].forEach(k => {
    assert(jsonStr.indexOf('"' + k + '"') === -1, 'staff_bootstrap не должен содержать финансовый/приватный ключ ' + k);
  });
  Object.keys(boot.userDrafts || {}).forEach(k => {
    assert(k.indexOf('Алина') === -1, 'Соня не должна видеть черновик Алины');
  });
  (boot.checklists || []).forEach(c => {
    assert(c.who !== 'Алина', 'Соня не должна видеть чек-лист Алины');
  });
});

test('v4-4. Идемпотентность проверяется строго ПОСЛЕ авторизации и привязана к субъекту', () => {
  const opId = 'op_v4_subject_bound_001';
  const r1 = callPost({
    action: 'submit_cash',
    sessionToken: sonyaLogin.sessionToken,
    operationId: opId,
    date: '2026-11-16',
    cash: 1000,
    card: 500,
    checks: 30,
    writeoff: 0
  });
  assert(r1.ok === true, 'Первая операция Сони должна пройти');

  // Анонимный запрос с тем же operationId обязан получить отказ авторизации, а не replay!
  const anonReplay = callPost({ action: 'submit_cash', operationId: opId, date: '2026-11-16', cash: 1000, card: 500, checks: 30 });
  assert(anonReplay.ok === false && /STAFF_AUTH_REQUIRED/.test(anonReplay.error), 'Анонимный replay operationId должен отклоняться');

  // Другой сотрудник (Алина) с тем же operationId обязан получить FORBIDDEN!
  const otherReplay = callPost({
    action: 'submit_cash',
    sessionToken: alinaLogin.sessionToken,
    operationId: opId,
    date: '2026-11-16',
    cash: 1000,
    card: 500,
    checks: 30
  });
  assert(otherReplay.ok === false && /FORBIDDEN/.test(otherReplay.error), 'Чужой replay operationId должен отклоняться FORBIDDEN');
});

test('v4-5. Delta Sync фильтрует поля вложенных объектов и блокирует IDOR', () => {
  // Админ кладёт инцидент с внутренним полем internalAdminCost
  callPost({
    action: 'delta_sync',
    sessionToken: adminLogin.sessionToken,
    deltas: [{
      collection: 'incidents',
      id: 'INC-V4-1',
      updatedAt: Date.now(),
      record: { id: 'INC-V4-1', text: 'Кофемолка', status: 'Новая', internalAdminCost: 9999, profitImpact: -500 }
    }]
  });
  const staffDelta = callPost({ action: 'delta_sync', sessionToken: sonyaLogin.sessionToken, sinceTs: 0, deltas: [] });
  assert(staffDelta.ok === true, 'staff delta_sync должен отвечать ok:true');
  const inc = (staffDelta.deltas || []).find(d => d.id === 'INC-V4-1');
  assert(inc && inc.record && !('internalAdminCost' in inc.record) && !('profitImpact' in inc.record), 'Delta Sync должен вырезать неразрешённые поля у staff');

  // Попытка Сони перезаписать чужой userDraft (Алина) через delta_sync отклоняется
  const idor = callPost({
    action: 'delta_sync',
    sessionToken: sonyaLogin.sessionToken,
    deltas: [{
      collection: 'userDrafts',
      id: '2026-11-16:Алина:Открытие',
      updatedAt: Date.now(),
      record: { userName: 'Алина', block: 'Открытие', idx: 99 }
    }]
  });
  assert(idor.ok === false && /FORBIDDEN/.test(idor.error), 'Попытка перезаписать чужой черновик через delta_sync должна отклоняться');
});

test('v4-6. Сессия восстанавливается из PropertiesService при вытеснении CacheService', () => {
  delete scriptCache['sess_' + sonyaLogin.sessionToken];
  const bootAfterEvict = callPost({ action: 'staff_bootstrap', sessionToken: sonyaLogin.sessionToken });
  assert(bootAfterEvict.ok === true && bootAfterEvict.profile.displayName === 'Соня', 'Сессия должна восстанавливаться при вытеснении CacheService');
});

test('v4-7. Честная финансовая модель: dashboard помечает отсутствующую себестоимость как missing', () => {
  const dash = callPost({ action: 'dashboard', sessionToken: adminLogin.sessionToken, date: '2026-11-16' });
  assert(dash.ok === true && dash.kpi && dash.kpi.cogs.dataQuality === 'missing' && dash.kpi.cogs.value === null, 'COGS без рецептур должен иметь dataQuality: missing и value: null');
});

test('v4-8. Разделение клиентских бандлов: index.html не загружает аналитику и подключает theme.js', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(indexHtml.indexOf('js/analytics.js') === -1, 'index.html (терминал бариста) не должен загружать js/analytics.js');
  assert(indexHtml.indexOf('js/sales-reconciliation.js') === -1, 'index.html не должен загружать js/sales-reconciliation.js');
  assert(indexHtml.indexOf('js/theme.js') !== -1, 'index.html должен подключать js/theme.js в <head>');
});


test('v4.1-9. Передача смены (handover_shift), списания (submit_writeoff) и append-only корректировки (submit_adjustment)', () => {
  const hnd = callPost({
    action: 'handover_shift',
    sessionToken: sonyaLogin.sessionToken,
    toStaff: 'Алина',
    equipmentState: 'Кофемашина исправна',
    openTasks: ['t3'],
    notes: 'Молоко на остатке 4 л',
    confirmedByReceiver: true
  });
  assert(hnd.ok === true && hnd.immutable === true && hnd.fromStaff === 'Соня' && hnd.toStaff === 'Алина', 'handover_shift должен фиксировать передачу смены');

  const wo = callPost({
    action: 'submit_writeoff',
    sessionToken: sonyaLogin.sessionToken,
    itemName: 'Молоко 3.2%',
    qty: 1.5,
    reason: 'Истёк срок годности',
    date: '2026-11-16'
  });
  assert(wo.ok === true && wo.writeoffId && wo.status === 'Ожидает проверки', 'submit_writeoff должен регистрировать списание');

  // Бариста не может делать административную корректировку
  const staffAdj = callPost({
    action: 'submit_adjustment',
    sessionToken: sonyaLogin.sessionToken,
    entityType: 'cash',
    targetId: 'CASH-1',
    reason: 'Попытка подмены'
  });
  assert(staffAdj.ok === false && /FORBIDDEN/.test(staffAdj.error), 'Бариста не должен иметь доступ к submit_adjustment');

  // Администратор создаёт append-only корректировку
  const admAdj = callPost({
    action: 'submit_adjustment',
    sessionToken: adminLogin.sessionToken,
    entityType: 'cash',
    targetId: 'CASH-1',
    reason: 'Сверка Z-отчёта',
    beforeSummary: { cash: 1000 },
    afterSummary: { cash: 1050 }
  });
  assert(admAdj.ok === true && admAdj.appendOnly === true && admAdj.adjustmentId, 'Администратор должен создавать append-only корректировку');
});


test('S-01 + S-06b + R-12. Защита change_staff_pin при PIN_CHANGE_REQUIRED, отзыв старых сессий по epoch и экранирование HTML в Telegram', () => {
  scriptProps['PIN_CHANGE_REQUIRED_Соня'] = '1';
  const hijack = callPost({ action: 'change_staff_pin', staffName: 'Соня', newPin: '998877' });
  assert(hijack.ok === false && /PIN_REQUIRED|PIN_INVALID/.test(hijack.error), 'Аноним не может сменить PIN даже при PIN_CHANGE_REQUIRED=1');

  const resetIssued = callPost({ action: 'issue_staff_reset_code', sessionToken: adminLogin.sessionToken, staffName: 'Соня' });
  assert(resetIssued.ok === true && /^\d{8}$/.test(resetIssued.resetCode), 'Админ должен выдавать 8-значный одноразовый код сброса');

  const oldTok = sonyaLogin.sessionToken;
  const chgOk = callPost({ action: 'change_staff_pin', staffName: 'Соня', resetCode: resetIssued.resetCode, newPin: '482910' });
  assert(chgOk.ok === true && chgOk.pinChanged === true, 'Смена PIN по одноразовому коду должна проходить');

  const oldSessCheck = callPost({ action: 'staff_bootstrap', sessionToken: oldTok });
  assert(oldSessCheck.ok === false, 'Старый токен должен отзываться после смены PIN (epoch)');

  const replayCode = callPost({ action: 'change_staff_pin', staffName: 'Соня', resetCode: resetIssued.resetCode, newPin: '112233' });
  assert(replayCode.ok === false, 'Одноразовый код сброса не должен работать повторно');

  assert(gasCtx.escapeTgHtml_('<b>xss</b> & <a href="x">') === '&lt;b&gt;xss&lt;/b&gt; &amp; &lt;a href="x"&gt;', 'escapeTgHtml_ должен экранировать HTML-теги');
});


test('v87.1. save_staff_pins отзывает старые сессии, PIN_CHANGE_REQUIRED блокирует живую сессию, isIncident без ReferenceError и hashPinV2_', () => {
  // 1. hashPinV2_ с разными солями и PIN_PEPPER
  const h1 = gasCtx.hashPinV2_('556677');
  const h2 = gasCtx.hashPinV2_('556677');
  assert(h1.indexOf('v2$') === 0 && h1 !== h2 && gasCtx.verifyPinStored_(h1, '556677'), 'hashPinV2_ должен давать разные солёные хеши');

  // 2. submit_checklist с isIncident: true не падает с ReferenceError
  const chkInc = callPost({
    action: 'submit_checklist',
    sessionToken: alinaLogin.sessionToken,
    block: 'Открытие',
    items: [{ id: 'o01', title: '<b>Кофемашина</b>', isIncident: true, comment: 'Течь & пар' }]
  });
  assert(chkInc.ok === true, 'submit_checklist с isIncident должен выполняться без ReferenceError');

  // 3. save_staff_pins отзывает старую сессию Алины
  const alinaOldTok = alinaLogin.sessionToken;
  callPost({ action: 'save_staff_pins', sessionToken: adminLogin.sessionToken, pins: [{ name: 'Алина', pin: '774411' }] });
  const alinaAfterAdminPin = callPost({ action: 'staff_bootstrap', sessionToken: alinaOldTok });
  assert(alinaAfterAdminPin.ok === false, 'save_staff_pins должен отзывать старую сессию через bumpSessionEpoch_');

  // 4. PIN_CHANGE_REQUIRED блокирует даже активную сессию
  const alinaNewLogin = callPost({ action: 'auth_login', role: 'staff', staffName: 'Алина', pin: '774411' });
  assert(alinaNewLogin.ok === true && alinaNewLogin.sessionToken, 'Вход по новому PIN должен работать');
  scriptProps['PIN_CHANGE_REQUIRED_Алина'] = '1';
  const blockedByFlag = callPost({ action: 'staff_bootstrap', sessionToken: alinaNewLogin.sessionToken });
  assert(blockedByFlag.ok === false && /PIN_CHANGE_REQUIRED/.test(blockedByFlag.error), 'PIN_CHANGE_REQUIRED должен блокировать действующую сессию');
  delete scriptProps['PIN_CHANGE_REQUIRED_Алина'];
});

console.log('\nИТОГО ТЕСТОВ COFFEE ILLY v87.1: ' + passed + '/' + passed + ' успешно.');
