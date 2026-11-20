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
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = data[r + i - 1] || [];
            out.push(row.slice(c - 1, c - 1 + nc));
          }
          return out;
        }
      }),
      _rows: data
    };
  }

  const mockSs = {
    getSheetByName: (n) => sheets.get(n) || null,
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
    UrlFetchApp: {
      fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"ok":true}' })
    }
  };

  vm.createContext(sandbox);
  const src = fs.readFileSync(gasPath, 'utf8');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  return { sandbox, mockSs, sheets, propsStore };
}

test('GAS doGet(get_rev) returns ok:true and v97.2.0 without ReferenceError', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const out = sandbox.doGet({ parameter: { action: 'get_rev' } });
  const json = JSON.parse(out.getContent());
  assert.equal(json.ok, true, 'doGet(get_rev) must succeed');
  assert.equal(json.serverVersion, 'v97.2.0');
  assert.equal(json.api, 2);
});

test('GAS doGet(version) returns v97.2.0 and specVersion 5.0', { skip: !hasGas }, () => {
  const { sandbox } = createMockGasSandbox();
  const out = sandbox.doGet({ parameter: { action: 'version' } });
  const json = JSON.parse(out.getContent());
  assert.equal(json.ok, true);
  assert.equal(json.serverVersion, 'v97.2.0');
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
