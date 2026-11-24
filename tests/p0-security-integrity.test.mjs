import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const gasPath = fs.existsSync(path.resolve(root, '../coffee-illy-gas/Code.gs'))
  ? path.resolve(root, '../coffee-illy-gas/Code.gs')
  : path.resolve(root, 'Code.gs');
const cloudPath = path.resolve(root, 'js/cloud-sync.js');
const csvPath = path.resolve(root, 'js/pos-csv-parser.js');
const hasGas = fs.existsSync(gasPath);

function createMockSheet(name) {
  const rows = [];
  const norm = (n) => Math.max(1, n);
  return {
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    appendRow: (r) => { rows.push(Array.from(r)); },
    clearContents: () => { rows.length = 0; },
    deleteRow: (r) => { rows.splice(r - 1, 1); },
    getDataRange: () => ({
      getValues: () => (rows.length ? rows.map((r) => Array.from(r)) : [['']])
    }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = rows[r - 1 + i] || [];
          const slice = [];
          for (let j = 0; j < nc; j++) slice.push(row[c - 1 + j] ?? '');
          out.push(slice);
        }
        return out;
      },
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          const ri = r - 1 + i;
          while (rows.length <= ri) rows.push([]);
          for (let j = 0; j < vals[i].length; j++) rows[ri][c - 1 + j] = vals[i][j];
        }
      },
      setValue: (v) => {
        const ri = r - 1;
        while (rows.length <= ri) rows.push([]);
        rows[ri][c - 1] = v;
      },
      setFontWeight: function () { return this; },
      setBackground: function () { return this; },
      setFontColor: function () { return this; }
    }),
    setFrozenRows: () => {},
    autoResizeColumns: () => {}
  };
}

function createGasSandbox({ boundSpreadsheet = true } = {}) {
  const sheets = new Map();
  const props = new Map();
  const cache = new Map();
  const mockSs = {
    getId: () => 'TEST_SHEET_ID',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const sh = createMockSheet(n); sheets.set(n, sh); return sh; },
    getSheets: () => Array.from(sheets.values())
  };
  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'GMT+2' },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (boundSpreadsheet ? mockSs : null),
      openById: (id) => {
        if (!id) throw new Error('Invalid ID');
        return mockSs;
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({ _t: txt, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
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
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"ok":true}' }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gasPath, 'utf8'), sandbox, { filename: 'Code.gs' });
  return { sandbox, sheets, props, mockSs };
}

test('P0.1/P0.3 Static security audit: no hardcoded PINs, TG IDs, or local auth bypasses in HTML clients', () => {
  for (const fn of ['index.html', 'dashboard.html', 'owner.html']) {
    const src = fs.readFileSync(path.resolve(root, fn), 'utf8');
    assert.equal(/adminPin\s*=\s*['"]1234['"]/.test(src), false, `${fn} must not contain hardcoded adminPin`);
    assert.equal(/pin:\s*['"]1234['"]/.test(src), false, `${fn} must not contain hardcoded staff pin 1234`);
    assert.equal(/pinBuf\s*===\s*st\.pin/.test(src), false, `${fn} must not compare PIN locally`);
    assert.equal(/entered\s*===\s*state\.adminPin/.test(src), false, `${fn} must not allow local adminPin fallback`);
    assert.equal(/TG-518294012|TG-604912338/.test(src), false, `${fn} must not contain hardcoded Telegram IDs`);
  }
});

test('P0.4 Code.gs contains no hardcoded spreadsheet ID and throws SETUP_REQUIRED when unconfigured', { skip: !hasGas }, () => {
  const gasSrc = fs.readFileSync(gasPath, 'utf8');
  assert.equal(gasSrc.includes('1FWFec1EvqeQ_2lnVIftyTgkeYfzIqFmmRWucpAaedqM'), false, 'Code.gs must not hardcode spreadsheet ID');
  const { sandbox } = createGasSandbox({ boundSpreadsheet: false });
  assert.throws(() => sandbox.getTargetSpreadsheet_(), /SETUP_REQUIRED/);
});

test('P0.2 Server-verified PIN change rejects wrong oldPin, updates hash, revokes old session, and enforces new PIN', { skip: !hasGas }, () => {
  const { sandbox, mockSs } = createGasSandbox({ boundSpreadsheet: true });
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  sandbox.saveStaff_(mockSs, { name: 'Соня', role: 'Бариста', pin: '1234', active: 'да' });

  const login1 = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', name: 'Соня', pin: '1234' }) } }).getContent());
  assert.equal(login1.ok, true);
  assert.ok(login1.sessionToken);

  // Wrong oldPin must fail
  const badChg = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'change_staff_pin', staffName: 'Соня', oldPin: '9999', newPin: '4829' }) } }).getContent());
  assert.equal(badChg.ok, false);

  // Valid oldPin must succeed and bump session epoch
  const okChg = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'change_staff_pin', staffName: 'Соня', oldPin: '1234', newPin: '4829' }) } }).getContent());
  assert.equal(okChg.ok, true);
  assert.equal(okChg.pinChanged, true);

  // Old session must be revoked (epoch mismatch)
  const oldSessCheck = sandbox.getServerSession_(login1.sessionToken);
  assert.equal(oldSessCheck, null, 'Old session token must be invalidated after PIN change');

  // Old PIN must fail, new PIN must succeed
  const loginOld = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', name: 'Соня', pin: '1234' }) } }).getContent());
  assert.equal(loginOld.ok, false);
  const loginNew = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', name: 'Соня', pin: '4829' }) } }).getContent());
  assert.equal(loginNew.ok, true);

  // auth_logout must revoke the new session
  const logoutRes = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_logout', sessionToken: loginNew.sessionToken }) } }).getContent());
  assert.equal(logoutRes.ok, true);
  assert.equal(sandbox.getServerSession_(loginNew.sessionToken), null, 'Session must be revoked after auth_logout');
});

test('P0.5 POS CSV re-import is idempotent for warehouse deduction and uses composite transaction dedup key across dates', { skip: !hasGas }, async () => {
  const { sandbox, mockSs, sheets } = createGasSandbox({ boundSpreadsheet: true });
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  const tok = login.sessionToken;

  const beans0 = sandbox.getSeededInventory_(mockSs).find((x) => x.id === 'inv_beans_illy').stock;
  const csvMod = await import(csvPath);
  const csvParser = csvMod.default || csvMod;
  const sampleCsv = 'Дата;Кассир;Товар;Количество;Сумма\n2026-11-20;Сырбу;Капучино;10;190';
  const parsed = csvParser.parsePosBatch([{ name: 'report_2026-11-20.csv', text: sampleCsv }]);

  // Import #1
  const r1 = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'batch_submit_cash', sessionToken: tok, days: parsed.days, mergeMode: 'sum' }) } }).getContent());
  assert.equal(r1.ok, true);
  const beans1 = sandbox.getSeededInventory_(mockSs).find((x) => x.id === 'inv_beans_illy').stock;
  assert.equal(beans1, beans0 - 90, 'First import deducts 90g beans');

  // Import #2 (exact same CSV re-imported) — MUST NOT deduct again
  const r2 = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'batch_submit_cash', sessionToken: tok, days: parsed.days, mergeMode: 'sum' }) } }).getContent());
  assert.equal(r2.ok, true);
  const beans2 = sandbox.getSeededInventory_(mockSs).find((x) => x.id === 'inv_beans_illy').stock;
  assert.equal(beans2, beans1, 'Re-importing identical CSV must NOT double-deduct warehouse stock');

  // Composite transaction dedup: same receiptNo #101 on two different dates must BOTH be stored
  sandbox.submitCash_(mockSs, {
    date: '2026-11-20', cash: 100, card: 0, checks: 1, barista: 'Соня',
    transactions: [{ date: '2026-11-20', time: '09:00', receiptNo: '101', amount: 100, paymentType: 'cash', userRaw: 'Сырбу' }]
  });
  sandbox.submitCash_(mockSs, {
    date: '2026-11-21', cash: 120, card: 0, checks: 1, barista: 'Соня',
    transactions: [{ date: '2026-11-21', time: '09:05', receiptNo: '101', amount: 120, paymentType: 'cash', userRaw: 'Сырбу' }]
  });
  // Duplicate on same date 2026-11-21 must be skipped
  const dupTx = sandbox.submitCash_(mockSs, {
    date: '2026-11-21', cash: 120, card: 0, checks: 1, barista: 'Соня',
    transactions: [{ date: '2026-11-21', time: '09:05', receiptNo: '101', amount: 120, paymentType: 'cash', userRaw: 'Сырбу' }]
  });
  assert.equal(dupTx.txSkipped, 1, 'Duplicate check on same date/cashier must be skipped');
  const txSheet = sheets.get('Транзакции');
  assert.equal(txSheet.getLastRow(), 3, 'Header + 2 distinct date transactions with receiptNo 101 must be stored');
});
