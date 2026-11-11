'use strict';
/**
 * Серверные интеграционные тесты Code.gs с моками Google Apps Script API
 * (SpreadsheetApp, LockService, CacheService, PropertiesService, Utilities, DriveApp, ContentService).
 * Проверяют закрытие всех 6 блокеров из AUDIT_REPORT.md и ARCHITECTURE_V22.md.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const cacheStore = {};
const propStore = {};
const sheetsStore = {};
const driveFiles = [];

function makeSheet(name) {
  const rows = [];
  return {
    getName() { return name; },
    appendRow(arr) { rows.push(arr.slice()); },
    getLastRow() { return rows.length; },
    getDataRange() {
      return {
        getValues() { return rows.length ? rows.map((r) => r.slice()) : [[]]; }
      };
    },
    getRange(r, c, numR, numC) {
      return {
        getValue() { return (rows[r - 1] && rows[r - 1][c - 1]) !== undefined ? rows[r - 1][c - 1] : ''; },
        setValue(val) {
          while (rows.length < r) rows.push([]);
          rows[r - 1][c - 1] = val;
        },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            while (rows.length < r + i) rows.push([]);
            rows[r - 1 + i] = vals[i].slice();
          }
        },
        createTextFinder(needle) {
          return {
            matchEntireCell() {
              return {
                findNext() {
                  for (let i = r - 1; i < Math.min(rows.length, r - 1 + (numR || rows.length)); i++) {
                    if (String(rows[i][c - 1] || '') === String(needle)) {
                      return { getRow() { return i + 1; } };
                    }
                  }
                  return null;
                }
              };
            }
          };
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
  insertSheet(n) { sheetsStore[n] = makeSheet(n); return sheetsStore[n]; }
};

const gasContext = {
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
  RegExp,
  Error,
  isNaN,
  isFinite,
  parseInt,
  parseFloat,
  LockService: {
    getScriptLock() {
      return { waitLock() {}, releaseLock() {} };
    }
  },
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
  SpreadsheetApp: {
    getActiveSpreadsheet() { return mockSS; }
  },
  Session: {
    getScriptTimeZone() { return 'GMT+2'; }
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(alg, str) {
      const buf = crypto.createHash('sha256').update(String(str), 'utf8').digest();
      return Array.from(buf);
    },
    getUuid() { return crypto.randomUUID(); },
    formatDate(d, tz, fmt) {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
      if (fmt === 'yyyy-MM-dd') return iso.slice(0, 10);
      if (fmt === 'HH:mm') return iso.slice(11, 16);
      return iso;
    },
    base64Decode(b64) { return Buffer.from(b64, 'base64'); },
    newBlob(bytes, mimeType, name) { return { bytes, mimeType, name }; }
  },
  DriveApp: {
    getFolderById() { return this._folder; },
    getFoldersByName() { return { hasNext() { return false; }, next() { return null; } }; },
    createFolder(name) {
      this._folder = {
        getId() { return 'folder_mock_123'; },
        createFile(blob) {
          const f = {
            id: 'file_mock_' + (driveFiles.length + 1),
            name: blob.name,
            url: 'https://drive.google.com/file/d/mock_' + (driveFiles.length + 1) + '/view'
          };
          driveFiles.push(f);
          return { getId() { return f.id; }, getUrl() { return f.url; } };
        }
      };
      return this._folder;
    }
  },
  UrlFetchApp: {
    fetch() { return { getResponseCode() { return 200; }, getContentText() { return '{"ok":true}'; } }; }
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput(str) {
      return {
        _text: str,
        setMimeType() { return this; },
        getContent() { return this._text; }
      };
    }
  }
};

vm.createContext(gasContext);
const codeGsSource = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
vm.runInContext(codeGsSource, gasContext, { filename: 'Code.gs' });

function callPost(payload) {
  const out = gasContext.doPost({ postData: { contents: JSON.stringify(payload) } });
  return JSON.parse(out.getContent());
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('[PASS] ' + name + '\n');
  } catch (e) {
    process.stderr.write('[FAIL] ' + name + ': ' + e.message + '\n');
    process.exitCode = 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

check('1. Серверная аутентификация владельца и ротация заводских PIN-кодов (setup_initial_credentials)', () => {
  const loginDefault = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '1234' });
  assert(loginDefault.ok === true && loginDefault.sessionToken, 'Первый вход до ротации должен выдать sessionToken');

  const rotated = callPost({
    action: 'setup_initial_credentials',
    sessionToken: loginDefault.sessionToken,
    newAdminPin: '8492',
    staffPins: { 'Соня': '5719' }
  });
  assert(rotated.ok === true && rotated.factoryPinsDisabled === true, 'Ротация PIN должна отключить заводские PIN-коды');

  const oldPinTry = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '1234' });
  assert(oldPinTry.ok === false && /PIN_REQUIRED/.test(oldPinTry.error), 'После ротации заводской PIN 1234 должен отклоняться сервером');

  const newPinTry = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '8492' });
  assert(newPinTry.ok === true && newPinTry.sessionToken, 'Новый индивидуальный PIN владельца 8492 должен приниматься');

  const savedHash = propStore.ADMIN_PIN_HASH;
  delete propStore.ADMIN_PIN_HASH;
  gasContext.saveSetting_(mockSS, { id: 'ADMIN_PIN', value: '1234' });
  let fallbackRejected = false;
  try { gasContext.verifyOwnerPinServer_(mockSS, '1234', 'admin_fallback_test'); }
  catch (e) { fallbackRejected = /SECURITY_NOT_CONFIGURED/.test(String(e.message || e)); }
  propStore.ADMIN_PIN_HASH = savedHash;
  assert(fallbackRejected, 'При FACTORY_PINS_DISABLED старый открытый ADMIN_PIN в таблице не должен включать заводской PIN');
});

check('2. Серверная сессия бариста (Staff Session) и защита от подмены имени сотрудника', () => {
  const badStaffPin = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '1111' });
  assert(badStaffPin.ok === false, 'Старый заводской PIN 1111 Сони должен отклоняться после установки 5719');

  const goodStaffLogin = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '5719' });
  assert(goodStaffLogin.ok === true && goodStaffLogin.sessionToken, 'Вход Сони по индивидуальному PIN 5719 выдаёт staff sessionToken');

  // Попытка отправить чек-лист от имени «Алина», используя сессию «Соня»
  const resChk = callPost({
    action: 'submit_checklist',
    sessionToken: goodStaffLogin.sessionToken,
    userName: 'Алина',
    block: 'Открытие',
    items: [{ id: 'o01', title: 'Селфи', isIncident: false }]
  });
  assert(resChk.ok === true, 'Отправка чек-листа с валидной staff-сессией должна пройти');
  const chkRows = sheetsStore['Чек-листы']._rows;
  const lastRow = chkRows[chkRows.length - 1];
  assert(lastRow[3] === 'Соня', 'Сервер обязан записать имя из проверенной сессии (Соня), а не подменённое (Алина)');

  const unauth = callPost({ action: 'submit_checklist', userName: 'Соня', block: 'Закрытие', items: [] });
  assert(unauth.ok === false && /STAFF_SESSION_REQUIRED/.test(unauth.error), 'Чек-лист без серверной staff-сессии должен отклоняться');
});

check('3. Серверная валидация входных данных кассы и расходов (отклонение отрицательных сумм и неверных дат)', () => {
  const staff = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '5719' });
  const badDate = callPost({ action: 'submit_cash', sessionToken: staff.sessionToken, date: '11-11-2026', cash: 1000, card: 500, checks: 40 });
  assert(badDate.ok === false && /VALIDATION_FAILED/.test(badDate.error), 'Неверный формат даты должен отклоняться VALIDATION_FAILED');

  const negCash = callPost({ action: 'submit_cash', sessionToken: staff.sessionToken, date: '2026-11-11', cash: -500, card: 500, checks: 40 });
  assert(negCash.ok === false && /VALIDATION_FAILED/.test(negCash.error), 'Отрицательная сумма наличных должна отклоняться VALIDATION_FAILED');

  const impossibleDate = callPost({ action: 'submit_cash', sessionToken: staff.sessionToken, date: '2026-02-31', cash: 500, card: 500, checks: 40 });
  assert(impossibleDate.ok === false && /VALIDATION_FAILED/.test(impossibleDate.error), 'Несуществующая календарная дата должна отклоняться');
  const noSession = callPost({ action: 'submit_cash', date: '2026-11-11', cash: 500, card: 500, checks: 40, userName: 'Соня' });
  assert(noSession.ok === false && /STAFF_SESSION_REQUIRED/.test(noSession.error), 'Касса без серверной staff-сессии должна отклоняться');
});

check('4. Серверная идемпотентность (operationId предотвращает дублирование записи в Кассу)', () => {
  const opId = 'op_test_idempotency_20261111_0001';
  const staff = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '5719' });
  const r1 = callPost({ action: 'submit_cash', sessionToken: staff.sessionToken, operationId: opId, date: '2026-11-11', cash: 1200, card: 800, checks: 60, writeoff: 2, userName: 'Соня' });
  const rowsAfterFirst = sheetsStore['Касса']._rows.length;
  const r2 = callPost({ action: 'submit_cash', sessionToken: staff.sessionToken, operationId: opId, date: '2026-11-11', cash: 1200, card: 800, checks: 60, writeoff: 2, userName: 'Соня' });
  const rowsAfterSecond = sheetsStore['Касса']._rows.length;
  assert(r1.ok === true && r2.ok === true && rowsAfterFirst === rowsAfterSecond, 'Повторный запрос с тем же operationId не должен дублировать строку');
});

check('5. Серверное сохранение фотографий в Google Drive (upload_photo -> DriveApp + лист Медиафайлы)', () => {
  const validPngB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const staff = callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '5719' });
  const upRes = callPost({ action: 'upload_photo', sessionToken: staff.sessionToken, block: 'Открытие', userName: 'Соня', dataUri: validPngB64 });
  assert(upRes.ok === true && upRes.fileId && upRes.url.indexOf('https://drive.google.com/') === 0, 'upload_photo должен сохранять файл в DriveApp и возвращать URL');
  assert(sheetsStore['Медиафайлы'] && sheetsStore['Медиафайлы']._rows.length >= 2, 'Запись о медиафайле со сроком хранения должна добавляться в лист Медиафайлы');
});

process.stdout.write('\nИТОГО СЕРВЕРНЫХ ТЕСТОВ CODE.GS: ' + passed + '/5 успешно.\n');
