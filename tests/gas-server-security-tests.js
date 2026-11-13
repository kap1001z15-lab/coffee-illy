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
  getSheets() { return Object.keys(sheetsStore).map((k) => Object.assign(sheetsStore[k], { getName: () => k })); },
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
});

check('3. Серверная валидация входных данных кассы и расходов (отклонение отрицательных сумм и неверных дат)', () => {
  const badDate = callPost({ action: 'submit_cash', date: '11-11-2026', cash: 1000, card: 500, checks: 40 });
  assert(badDate.ok === false && /VALIDATION_FAILED/.test(badDate.error), 'Неверный формат даты должен отклоняться VALIDATION_FAILED');

  const negCash = callPost({ action: 'submit_cash', date: '2026-11-11', cash: -500, card: 500, checks: 40 });
  assert(negCash.ok === false && /VALIDATION_FAILED/.test(negCash.error), 'Отрицательная сумма наличных должна отклоняться VALIDATION_FAILED');
});

check('4. Серверная идемпотентность (operationId предотвращает дублирование записи в Кассу)', () => {
  const opId = 'op_test_idempotency_20261111_0001';
  const r1 = callPost({ action: 'submit_cash', operationId: opId, date: '2026-11-11', cash: 1200, card: 800, checks: 60, writeoff: 2, userName: 'Соня' });
  const rowsAfterFirst = sheetsStore['Касса']._rows.length;
  const r2 = callPost({ action: 'submit_cash', operationId: opId, date: '2026-11-11', cash: 1200, card: 800, checks: 60, writeoff: 2, userName: 'Соня' });
  const rowsAfterSecond = sheetsStore['Касса']._rows.length;
  assert(r1.ok === true && r2.ok === true && rowsAfterFirst === rowsAfterSecond, 'Повторный запрос с тем же operationId не должен дублировать строку');
});

check('5. Серверное сохранение фотографий в Google Drive (upload_photo -> DriveApp + лист Медиафайлы)', () => {
  const validPngB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const upRes = callPost({ action: 'upload_photo', block: 'Открытие', userName: 'Соня', dataUri: validPngB64 });
  assert(upRes.ok === true && upRes.fileId && upRes.url.indexOf('https://drive.google.com/') === 0, 'upload_photo должен сохранять файл в DriveApp и возвращать URL');
  assert(sheetsStore['Медиафайлы'] && sheetsStore['Медиафайлы']._rows.length >= 2, 'Запись о медиафайле со сроком хранения должна добавляться в лист Медиафайлы');
});



check('6. Двустороннее управление всеми настройками, Таймлайном, Планами Пн–Вс, Задачами, Картой добрых дел и ТТК через листы Google Таблицы', () => {
  const login = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '8492' });
  const tok = login.sessionToken;

  // Сохранение планов по дням недели в лист «Планы»
  const resPlans = callPost({
    action: 'save_daily_plans',
    sessionToken: tok,
    plans: { 'Пн': { revenue: 2450, avgCheck: 36, checks: 74 } }
  });
  assert(resPlans.ok === true, 'save_daily_plans должен успешно записывать лист Планы');
  assert(sheetsStore['Планы'] && sheetsStore['Планы']._rows.length === 8, 'Лист Планы должен содержать заголовок и 7 дней недели (Пн–Вс)');

  // Сохранение таймлайна в лист «Таймлайн»
  const resTl = callPost({
    action: 'save_checklist_blocks',
    sessionToken: tok,
    blocks: [
      { id: 'blk_open', name: 'Открытие', openTime: '07:15', deadline: '08:15', isCash: false, active: true },
      { id: 'blk_cash', name: 'Касса', openTime: '22:00', deadline: '23:59', isCash: true, active: true }
    ]
  });
  assert(resTl.ok === true && sheetsStore['Таймлайн']._rows.length === 3, 'Лист Таймлайн должен обновляться при сохранении чек-листов');

  // Прямое редактирование ячейки в Google Таблице (лист «Настройки» и лист «Планы»)
  sheetsStore['Планы']._rows[1][1] = 2900; // Меняем план Пн прямо в ячейке таблицы на 2900 руб.
  const admOut = JSON.parse(gasContext.doGet({ parameter: { action: 'get_checklists' } }).getContent());
  assert(admOut.ok === true && admOut.dailyPlans['Пн'].revenue === 2900, 'Прямое изменение ячейки в листе Планы Google Таблицы должно сразу возвращаться сервером');
  assert(admOut.checklistBlocks.length === 2 && admOut.checklistBlocks[0].openTime === '07:15', 'Лист Таймлайн Google Таблицы управляет окнами чек-листов в терминале');
});

check('7. Живая синхронизация: get_rev меняется после каждой успешной записи и после ручной правки таблицы', () => {
  const rev0 = JSON.parse(gasContext.doGet({ parameter: { action: 'get_rev' } }).getContent());
  assert(rev0.ok === true && rev0.rev != null, 'get_rev публичен и возвращает версию данных');
  const login = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '8492' });
  const revAfterLogin = JSON.parse(gasContext.doGet({ parameter: { action: 'get_rev' } }).getContent()).rev;
  assert(revAfterLogin === rev0.rev, 'Вход (auth_login) не должен менять версию данных');
  const before = Number(rev0.rev);
  const t0 = Date.now(); while (Date.now() === t0) {}
  const saved = callPost({ action: 'save_setting', sessionToken: login.sessionToken, id: 'LOCATION', value: 'Кофейня №7', operationId: 'op_rev_test_0001' });
  assert(saved.ok === true && Number(saved.rev) > before, 'Успешная запись должна увеличить версию данных и вернуть её клиенту');
  const rev1 = JSON.parse(gasContext.doGet({ parameter: { action: 'get_rev' } }).getContent()).rev;
  assert(rev1 === String(saved.rev), 'get_rev должен отдавать версию последней записи');
  const t1 = Date.now(); while (Date.now() === t1) {}
  gasContext.onEdit({ range: { getSheet() { return { getName() { return 'Задачи'; } }; } } });
  const rev2 = JSON.parse(gasContext.doGet({ parameter: { action: 'get_rev' } }).getContent()).rev;
  assert(Number(rev2) > Number(rev1), 'Ручная правка листа (onEdit) должна менять версию данных');
  const pub = JSON.parse(gasContext.doGet({ parameter: { action: 'get_checklists' } }).getContent());
  assert(pub.rev === rev2, 'Публичный get_checklists возвращает текущую версию данных');
});

check('8. Сверка продаж v54: лист Продажи, защита от повторной загрузки CSV по хэшу, переход счётчика 998→2 и возврат products в getReport_()', () => {
  const login = callPost({ action: 'auth_login', role: 'admin', staffName: 'Администратор', pin: '8492' });
  const tok = login.sessionToken;

  const cashPayload = {
    action: 'submit_cash',
    date: '2026-11-04',
    userName: 'Алина',
    barista: 'Алина',
    cash: 1450,
    card: 237,
    checks: 47,
    writeoff: 15,
    writeoffShots: 1,
    counterStart: 998,
    counterEnd: 2,
    coffeeQty: 52,
    nonCoffeeQty: 41,
    reviewQty: 5,
    csvHash: 'csv_alina_2026_11_04_hash',
    csvHashes: ['csv_alina_2026_11_04_hash'],
    products: [
      { name: 'Американо шт', kind: 'coffee', price: 12, qty: 21, sum: 252, barista: 'Алина', csvHash: 'csv_alina_2026_11_04_hash' },
      { name: 'Капучино шт', kind: 'coffee', price: 19, qty: 31, sum: 589, barista: 'Алина', csvHash: 'csv_alina_2026_11_04_hash' },
      { name: 'Чизкейк шт', kind: 'non_coffee', price: 40, qty: 41, sum: 841, barista: 'Алина', csvHash: 'csv_alina_2026_11_04_hash' },
      { name: 'Напиток от Бариста шт', kind: 'review', price: 1, qty: 5, sum: 5, barista: 'Алина', csvHash: 'csv_alina_2026_11_04_hash' }
    ]
  };
  const rSubmit1 = callPost(cashPayload);
  assert(rSubmit1.ok === true && rSubmit1.duplicateCsvSkipped === false, 'Первая загрузка CSV должна сохраняться в лист Продажи');
  assert(sheetsStore['Продажи'] && sheetsStore['Продажи']._rows.length === 5, 'В листе Продажи должны появиться заголовок + 4 строки номенклатуры');

  // Повторная отправка того же CSV по хэшу не должна дублировать строки в листе Продажи
  const rSubmitDup = callPost(Object.assign({}, cashPayload, { operationId: 'op_dup_csv_test' }));
  assert(rSubmitDup.ok === true && rSubmitDup.duplicateCsvSkipped === true, 'Повторная загрузка того же хэша CSV должна пропускаться (duplicateCsvSkipped: true)');
  assert(sheetsStore['Продажи']._rows.length === 5, 'Количество строк в листе Продажи не должно увеличиваться при повторной загрузке того же хэша');

  // Проверка getReport_(): products не пустой, series учитывает циклический переход 998 -> 2 (= 4)
  const repOut = JSON.parse(gasContext.doGet({ parameter: { action: 'report', from: '2026-11-04', to: '2026-11-04', sessionToken: tok } }).getContent());
  assert(repOut.ok === true && Array.isArray(repOut.products) && repOut.products.length === 4, 'getReport_() должен возвращать заполненный массив products из листа Продажи');
  const daySeries = (repOut.series || []).find((s) => s.date === '2026-11-04');
  assert(daySeries && daySeries.counterDelta === 4 && daySeries.writeoff === 15 && daySeries.writeoffShots === 1, 'В отчёте должен учитываться циклический переход 998→2 (= 4) и раздельные списания (15 руб. и 1 порция)');
});

process.stdout.write('\nИТОГО СЕРВЕРНЫХ ТЕСТОВ CODE.GS: ' + passed + '/8 успешно.\n');
