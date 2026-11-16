'use strict';
/**
 * T10: Сквозной тест защиты всех точек входа doPost и doGet в Code.gs от анонимного доступа.
 * Автоматически извлекает все action === '...' из Code.gs и проверяет, что без sessionToken
 * каждое непубличное действие отклоняется с кодом STAFF_AUTH_REQUIRED или PIN_REQUIRED.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const cacheStore = {};
const propStore = {};
const sheetsStore = {};

function makeSheet(name) {
  const rows = [];
  return {
    getName() { return name; },
    appendRow(arr) { rows.push(arr.slice()); },
    getLastRow() { return rows.length; },
    getDataRange() { return { getValues() { return rows.length ? rows.map((r) => r.slice()) : [[]]; } }; },
    getRange(r, c, nr, nc) {
      return {
        getValue() { return (rows[r - 1] && rows[r - 1][c - 1]) !== undefined ? rows[r - 1][c - 1] : ''; },
        setValue(val) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = val; },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            while (rows.length < r + i) rows.push([]);
            rows[r - 1 + i] = vals[i].slice();
          }
        }
      };
    },
    deleteRow(r) { rows.splice(r - 1, 1); },
    deleteRows(r, count) { rows.splice(r - 1, count); },
    _rows: rows
  };
}

const mockSS = {
  getSheetByName(n) { return sheetsStore[n] || null; },
  getSheets() { return Object.keys(sheetsStore).map((k) => Object.assign(sheetsStore[k], { getName: () => k })); },
  insertSheet(n) { sheetsStore[n] = makeSheet(n); return sheetsStore[n]; }
};

const gasContext = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, isFinite, parseInt, parseFloat,
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  CacheService: {
    getScriptCache() {
      return {
        get(k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; },
        put(k, v) { cacheStore[k] = String(v); },
        remove(k) { delete cacheStore[k]; }
      };
    }
  },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(k) { return Object.prototype.hasOwnProperty.call(propStore, k) ? propStore[k] : null; },
        setProperty(k, v) { propStore[k] = String(v); }
      };
    }
  },
  SpreadsheetApp: { getActiveSpreadsheet() { return mockSS; } },
  Session: { getScriptTimeZone() { return 'GMT+2'; } },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(alg, str) { return Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()); },
    getUuid() { return crypto.randomUUID(); },
    formatDate(d, tz, fmt) {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
      return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : (fmt === 'HH:mm' ? iso.slice(11, 16) : iso);
    }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(str) { return { _text: str, setMimeType() { return this; }, getContent() { return this._text; } }; }
  }
};

vm.createContext(gasContext);
const codeGsSource = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
vm.runInContext(codeGsSource, gasContext, { filename: 'Code.gs' });

function callPost(payload) {
  return JSON.parse(gasContext.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
}
function callGet(params) {
  return JSON.parse(gasContext.doGet({ parameter: params }).getContent());
}

// 1. Первичная инициализация PIN владельца (после неё даже setup_initial_credentials закрыт!)
const initRes = callPost({
  action: 'setup_initial_credentials',
  newAdminPin: '849261',
  staffPins: { 'Соня': '5719', 'Алина': '6820' }
});
if (!initRes || initRes.ok !== true) {
  console.error('[FAIL] Ошибка первичной инициализации:', initRes);
  process.exit(1);
}

// 2. Извлекаем все action === '...' из функции doPost и doGet в Code.gs
const doPostBody = codeGsSource.slice(codeGsSource.indexOf('function doPost('), codeGsSource.indexOf('function isValidIsoDate_('));
const postActionsSet = new Set();
const actionRe = /action\s*===\s*'([a-zA-Z0-9_]+)'/g;
let m;
while ((m = actionRe.exec(doPostBody)) !== null) {
  postActionsSet.add(m[1]);
}

const publicPostAllowedAfterSetup = new Set(['auth_login', 'auth_logout']);
const samplePayloads = {
  submit_checklist: { block: 'Открытие', items: [] },
  submit_cash: { date: '2026-11-16', cash: 100, card: 100, checks: 10, writeoff: 0 },
  batch_submit_cash: { days: [{ date: '2026-11-16', cash: 100, card: 100, checks: 10, writeoff: 0 }] },
  add_expense: { date: '2026-11-16', amount: 100, category: 'Прочее' },
  save_task: { id: '__SYS_CONFIG_V19__', title: '__SYS_SYNC__', instruction: '{}' },
  delta_sync: { deltas: [{ collection: 'incidents', id: 'INC-1', updatedAt: Date.now(), record: {} }] },
  bind_telegram_user: { tgId: '12345', staffName: 'Соня' },
  change_staff_pin: { staffName: 'Соня', newPin: '9876' },
  setup_initial_credentials: { newAdminPin: '654321' }
};

let checkedCount = 0;
for (const act of postActionsSet) {
  if (publicPostAllowedAfterSetup.has(act)) continue;
  const payload = Object.assign({ action: act }, samplePayloads[act] || {});
  const res = callPost(payload);
  if (res.ok !== false || !/STAFF_AUTH_REQUIRED|PIN_REQUIRED|FORBIDDEN/.test(String(res.error || ''))) {
    console.error('[FAIL] Действие doPost "' + act + '" прошло без сессии или вернуло неожиданный ответ:', res);
    process.exit(1);
  }
  checkedCount++;
}

// Дополнительно проверим обычный save_task (не __SYS_CONFIG_V19__)
const regularSaveTask = callPost({ action: 'save_task', id: 'o01', title: 'Тест', block: 'Открытие' });
if (regularSaveTask.ok !== false || !/PIN_REQUIRED/.test(String(regularSaveTask.error || ''))) {
  console.error('[FAIL] Обычный save_task прошёл без сессии:', regularSaveTask);
  process.exit(1);
}
checkedCount++;

// Проверим приватные действия doGet без сессии
for (const getAct of ['dashboard', 'report', 'admin']) {
  const gRes = callGet({ action: getAct });
  if (gRes.ok !== false || !/PIN_REQUIRED/.test(String(gRes.error || ''))) {
    console.error('[FAIL] Действие doGet "' + getAct + '" прошло без сессии:', gRes);
    process.exit(1);
  }
  checkedCount++;
}

console.log('[PASS] 1. T10: Проверено ' + checkedCount + ' защищённых действий doPost/doGet — все отклоняют анонимный доступ (STAFF_AUTH_REQUIRED / PIN_REQUIRED)');
console.log('\nИТОГО СКВОЗНЫХ ТЕСТОВ АНОНИМНОГО ДОСТУПА: 1/1 (' + checkedCount + ' точек входа) успешно.');
