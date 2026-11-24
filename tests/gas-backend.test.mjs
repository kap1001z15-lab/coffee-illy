import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const gasPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../coffee-illy-gas/Code.gs'
);

const hasGas = fs.existsSync(gasPath);

function createMockGasSandbox() {
  const propsStore = new Map();
  const cacheStore = new Map();
  const sheets = new Map();

  function makeSheet(name, initialRows = []) {
    const data = initialRows.map((r) => r.slice());
    return {
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] ? data[0].length : 0),
      clearContents: () => { data.length = 0; },
      appendRow: (row) => { data.push(row.slice()); },
      deleteRow: (rIdx) => { data.splice(rIdx - 1, 1); },
      getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        setValue: (v) => {
          while (data.length < r) data.push([]);
          while (data[r - 1].length < c) data[r - 1].push('');
          data[r - 1][c - 1] = v;
        },
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            while (data.length < r + i) data.push([]);
            for (let j = 0; j < vals[i].length; j++) {
              while (data[r + i - 1].length < c + j) data[r + i - 1].push('');
              data[r + i - 1][c + j - 1] = vals[i][j];
            }
          }
        },
        setFontWeight: function () { return this; },
        setBackground: function () { return this; },
        setFontColor: function () { return this; },
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = data[r + i - 1] || [];
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        }
      }),
      setFrozenRows: () => {},
      _rows: data
    };
  }

  const mockSs = {
    getSheets: () => Array.from(sheets.values()),
    getSheetByName: (n) => sheets.get(n) || null,
    toast: () => {},
    insertSheet: (n) => {
      const s = makeSheet(n, []);
      sheets.set(n, s);
      return s;
    }
  };

  // Seed minimal sheets used by tests
  sheets.set('Чек-листы', makeSheet('Чек-листы', [
    ['Дата', 'Время', 'Блок', 'Бариста', 'Проблем', 'Фото JSON', 'Дедлайн', 'Статус срока'],
    ['2026-11-12', '22:17', 'Закрытие', 'Соня', 0, '[]', '22:30', 'В срок'],
    ['2026-11-19', '08:15', 'Открытие', 'Алина', 0, '[]', '08:30', 'В срок'],
    ['2026-11-19', '15:40', 'Лайн Чек 2', 'Алина', 1, '[]', '16:00', 'В срок']
  ]));
  sheets.set('Техкарты', makeSheet('Техкарты', [
    ['ID', 'Название', 'Объём', 'Категория', 'Цена', 'Зерно', 'Молоко', 'Сироп', 'Тара', 'Рецептура', 'Подача', 'Средняя цена']
  ]));
  sheets.set('Сотрудники', makeSheet('Сотрудники', [
    ['ID', 'Имя', 'Роль', 'Кофейня', 'Активен', 'PIN', 'Telegram ID']
  ]));
  sheets.set('Журнал', makeSheet('Журнал', [
    ['Дата', 'Время', 'Пользователь', 'Действие', 'Детали']
  ]));

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'Europe/Chisinau' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => mockSs,
      openById: () => mockSs
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (propsStore.has(k) ? propsStore.get(k) : null),
        setProperty: (k, v) => { propsStore.set(k, String(v)); },
        deleteProperty: (k) => { propsStore.delete(k); },
        getProperties: () => Object.fromEntries(propsStore.entries())
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cacheStore.has(k) ? cacheStore.get(k) : null),
        put: (k, v) => { cacheStore.set(k, String(v)); },
        remove: (k) => { cacheStore.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => true,
        releaseLock: () => {}
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        _text: txt,
        setMimeType: function () { return this; },
        getContent: function () { return this._text; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, _tz, fmt) => {
        const dt = d instanceof Date ? d : new Date(d);
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        if (fmt === 'HH:mm:ss') return `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
        if (fmt === 'HH:mm') return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        return dt.toISOString();
      }
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }), atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) })
    },
    UrlFetchApp: {
      fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"ok":true}' })
    }
  };

  vm.createContext(sandbox);
  const src = fs.readFileSync(gasPath, 'utf8');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  return { sandbox, mockSs, sheets, propsStore };
}

test('GAS doGet(get_rev) returns ok:true and v97.17.0 without ReferenceError', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const out = sandbox.doGet({ parameter: { action: 'get_rev' } });
  const json = JSON.parse(out.getContent());
  assert.equal(json.ok, true, 'doGet(get_rev) must succeed');
  assert.equal(json.serverVersion, 'v97.17.0');
  assert.equal(json.api, 2);
});

test('GAS doGet(version) returns v97.17.0 and specVersion 5.0', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const out = sandbox.doGet({ parameter: { action: 'version' } });
  const json = JSON.parse(out.getContent());
  assert.equal(json.ok, true);
  assert.equal(json.serverVersion, 'v97.17.0');
  assert.equal(json.specVersion, '5.0');
});

test('GAS built-in runSelfTests() passes all 9 assertions', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const res = sandbox.runSelfTests();
  assert.equal(res.ok, true);
  assert.equal(res.passed, 9);
});

test('GAS getChecklistsLogFromSheet_ sorts history strictly newest to oldest', { skip: !hasGas }, () => {
  const { sandbox, mockSs } = createMockGasSandbox();
  const log = sandbox.getChecklistsLogFromSheet_(mockSs);
  assert.equal(log.length, 3);
  assert.equal(log[0].date, '2026-11-19');
  assert.equal(log[0].time, '15:40');
  assert.equal(log[1].date, '2026-11-19');
  assert.equal(log[1].time, '08:15');
  assert.equal(log[2].date, '2026-11-12');
});

test('GAS Warehouse auto-seeds 25 items, syncs to Склад sheet, auto-deducts from sales, and deletes', { skip: !hasGas }, () => {
  const { sandbox, mockSs, sheets } = createMockGasSandbox();
  const inv = sandbox.getSeededInventory_(mockSs);
  assert.ok(inv.length >= 24, 'Should seed >=24 items including ice');
  assert.ok(sheets.get('Склад').getLastRow() >= 25, 'Should sync to Склад sheet');

  const beansBefore = inv.find((x) => x.id === 'inv_beans_illy').stock;
  sandbox.autoDeductInventoryFromSalesV97_(mockSs, [{ name: 'Капучино шт', qty: 10 }]);
  const invAfter = sandbox.getSeededInventory_(mockSs);
  const beansAfter = invAfter.find((x) => x.id === 'inv_beans_illy').stock;
  assert.equal(beansAfter, beansBefore - 90, '10 Cappuccinos should deduct 90g beans');

  const delRes = sandbox.deleteInventory_(mockSs, { id: 'inv_beans_decaf' });
  assert.equal(delRes.ok, true);
  assert.equal(delRes.inventory.some((x) => x.id === 'inv_beans_decaf'), false);
});

test('GAS saveTtk_ stores sale price, avgPrice, and zero cost', { skip: !hasGas }, () => {
  const { sandbox, mockSs, sheets } = createMockGasSandbox();
  const res = sandbox.saveTtk_(mockSs, {
    id: 'ttk_test',
    name: 'Капучино ILLY',
    volume: '250 мл',
    category: 'Классика',
    price: 19,
    avgPrice: 19,
    costBeans: 0,
    costMilk: 0,
    costSyrup: 0,
    costCup: 0,
    recipe: 'Эспрессо 36 г + молоко 180 мл',
    serving: 'Подавать в стакане 250 мл'
  });
  assert.equal(res.ok, true);
  const rows = sheets.get('Техкарты')._rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][4], 19);
  assert.equal(rows[1][5], 0);
  assert.equal(rows[1][11], 19);
});

test('GAS УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ binds spreadsheet and enables 1234 login', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const res = sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  assert.equal(res.ok, true);
  const okLogin = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  assert.equal(okLogin.ok, true);
  assert.ok(okLogin.sessionToken && okLogin.sessionToken.length > 10);
  const badLogin = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '9999' }) } }).getContent());
  assert.equal(badLogin.ok, false);
});

test('GAS saveTtk_ accepts frontend field aliases (vol, cat, serve, avgPrice)', { skip: !hasGas }, () => {
  const { sandbox, mockSs, sheets } = createMockGasSandbox();
  const res = sandbox.saveTtk_(mockSs, {
    id: 'ttk_alias',
    name: '☕ Латте ILLY',
    vol: '350 мл (L)',
    cat: 'Классика',
    price: 29,
    avgPrice: 28.5,
    costBeans: 0,
    costMilk: 0,
    costSyrup: 0,
    costCup: 0,
    recipe: 'Эспрессо 36 г + молоко 270 мл',
    serve: 'Стакан 350 мл с крышкой'
  });
  assert.equal(res.ok, true);
  const row = sheets.get('Техкарты')._rows.find((r) => r[0] === 'ttk_alias');
  assert.ok(row);
  assert.equal(row[2], '350 мл (L)');
  assert.equal(row[3], 'Классика');
  assert.equal(row[10], 'Стакан 350 мл с крышкой');
  assert.equal(row[11], 28.5);
});

test('GAS getAdmin_ computes cash.revenue, normalizes sales kinds, and merges legacy Coffee_illy_Cash products', { skip: !hasGas }, () => {
  const { sandbox, mockSs, sheets } = createMockGasSandbox();
  sandbox.ensureSheets_(mockSs);
  sheets.get('Касса').appendRow(['2026-11-18', 1200, 1300, 70, 0, 'Капучино', 'Соня']);
  sheets.get('Продажи').appendRow(['2026-11-18', 'Смена', 'Соня', 'Капучино', 'coffee', 19, 10, 190, 'hash1']);
  sheets.get('Продажи').appendRow(['2026-11-18', 'Смена', 'Соня', 'Чизкейк', 'non_coffee', 25, 2, 50, 'hash1']);
  const leg = mockSs.insertSheet('Coffee_illy_Cash');
  leg.appendRow(['Дата', 'Смена', 'Бариста', 'Нал', 'Безнал', 'Выручка', 'Чеки', 'СрЧек', 'Списание', 'Топ', 'Товары JSON']);
  leg.appendRow(['2026-10-30', '1', 'Алина', 500, 700, 1200, 30, 40, 0, '', JSON.stringify([{ name: 'Американо', qty: 5, sum: 95 }])]);

  const adm = sandbox.getAdmin_(mockSs);
  const c18 = adm.cash.find((c) => c.date === '2026-11-18');
  assert.ok(c18);
  assert.equal(c18.revenue, 2500);
  assert.equal(c18.total, 2500);
  const coffeeSale = adm.salesLog.find((s) => s.date === '2026-11-18' && s.name === 'Капучино');
  const nonCoffeeSale = adm.salesLog.find((s) => s.date === '2026-11-18' && s.name === 'Чизкейк');
  const legacySale = adm.salesLog.find((s) => s.date === '2026-10-30' && s.name === 'Американо');
  assert.equal(coffeeSale.kind, 'Кофе');
  assert.equal(nonCoffeeSale.kind, 'Не-кофе');
  assert.ok(legacySale && legacySale.qty === 5 && legacySale.kind === 'Кофе');
});

test('GAS doGet(get_checklists) executes sanitizePublicChecklists_ cleanly without ReferenceError', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const out = sandbox.doGet({ parameter: { action: 'get_checklists', nocache: '1' } });
  const json = JSON.parse(out.getContent());
  assert.equal(json.ok, true, 'doGet(get_checklists) must succeed: ' + JSON.stringify(json));
  assert.equal(json.serverVersion, 'v97.17.0');
  assert.ok(Array.isArray(json.staff));
});

test('GAS doPost(admin) with valid 1234 sessionToken returns full admin payload without errors', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  assert.equal(login.ok, true);
  const adm = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: login.sessionToken }) } }).getContent());
  assert.equal(adm.ok, true, 'doPost(admin) must succeed: ' + JSON.stringify(adm));
  assert.ok(Array.isArray(adm.cash));
  assert.ok(Array.isArray(adm.salesLog));
  assert.ok(Array.isArray(adm.inventory));
});

test('GAS doPost(staff_bootstrap) with valid admin sessionToken succeeds cleanly', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  const boot = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'staff_bootstrap', sessionToken: login.sessionToken }) } }).getContent());
  assert.equal(boot.ok, true, 'doPost(staff_bootstrap) must succeed: ' + JSON.stringify(boot));
  assert.ok(Array.isArray(boot.tasks));
});
