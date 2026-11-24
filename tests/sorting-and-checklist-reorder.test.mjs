import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const gasCodePath = path.resolve(rootDir, '..', 'coffee-illy-gas', 'Code.gs');

function createGasEnv() {
  const sheets = new Map();
  const propsStore = new Map();
  const cacheStore = new Map();

  function makeSheet(name) {
    const data = [];
    return {
      name,
      _data: data,
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] ? data[0].length : 0),
      appendRow: (row) => { data.push(row.slice()); },
      clear: () => { data.length = 0; },
      setFrozenRows: () => {},
      autoResizeColumns: () => {},
      deleteRow: (r) => { data.splice(r - 1, 1); },
      deleteRows: (r, count) => { data.splice(r - 1, count); },
      getDataRange: () => ({ getValues: () => (data.length ? data.map((r) => r.slice()) : [[]]) }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        setFontWeight: () => ({ setBackground: () => ({ setFontColor: () => {} }) }),
        setBackground: () => ({ setFontColor: () => {} }),
        setFontColor: () => {},
        clearContent: () => {},
        getValue: () => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : ''),
        setValue: (v) => {
          while (data.length < r) data.push([]);
          while (data[r - 1].length < c) data[r - 1].push('');
          data[r - 1][c - 1] = v;
        },
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            const ri = r - 1 + i;
            while (data.length <= ri) data.push([]);
            for (let j = 0; j < vals[i].length; j++) data[ri][c - 1 + j] = vals[i][j];
          }
        },
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((data[r - 1 + i] && data[r - 1 + i][c - 1 + j]) ?? '');
            out.push(row);
          }
          return out;
        }
      })
    };
  }

  const ss = {
    getId: () => 'TEST_SHEET_V9713',
    getSheets: () => Array.from(sheets.values()),
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => { const sh = makeSheet(name); sheets.set(name, sh); return sh; }
  };

  const sandbox = {
    console, Logger: { log: () => {} }, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
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
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'GMT+2' },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()),
      computeHmacSha256Signature: (data, key) => Array.from(crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest()),
      formatDate: (d, _tz, fmt) => {
        const dt = d instanceof Date ? d : new Date(d);
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
        if (fmt === 'HH:mm') return `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
        if (fmt === 'u') return String(dt.getUTCDay() === 0 ? 7 : dt.getUTCDay());
        return dt.toISOString();
      },
      getUuid: () => crypto.randomUUID(),
      base64Decode: (s) => Buffer.from(s, 'base64'),
      newBlob: (b, t, n) => ({ bytes: b, type: t, name: n })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({ _txt: txt, setMimeType() { return this; }, getContent() { return this._txt; } })
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gasCodePath, 'utf8'), sandbox, { filename: 'Code.gs' });
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ();
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  const token = login.sessionToken;
  // Seed 4 tasks (3 in Открытие, 1 in Закрытие) via save_task
  [
    { id: 'o01', block: 'Открытие', title: 'Фото-селфи', instruction: 'Сделать фото', photo: 'да' },
    { id: 'o02', block: 'Открытие', title: 'Зал и столы', instruction: 'Протереть столы', photo: 'да' },
    { id: 'o03', block: 'Открытие', title: 'Кофемашина', instruction: 'Прогреть группы', photo: 'да' },
    { id: 'c01', block: 'Закрытие', title: 'Касса и терминал', instruction: 'Пересчитать наличные', photo: 'да' }
  ].forEach((tk) => {
    const r = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'save_task', sessionToken: token, ...tk }) } }).getContent());
    assert.equal(r.ok, true);
  });
  return { sandbox, ss, token };
}

test('GAS reorder_tasks persists exact barista step order in Задачи sheet and bumps DATA_REV without affecting other blocks', () => {
  const { sandbox, token } = createGasEnv();

  // Read initial tasks for Открытие and Закрытие
  const before = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const openBefore = before.tasks.filter((t) => t.block === 'Открытие').map((t) => t.id);
  const closeBefore = before.tasks.filter((t) => t.block === 'Закрытие').map((t) => t.id);
  assert.ok(openBefore.length >= 3, 'Expected at least 3 tasks in Открытие');

  // Move 3rd task to 1st position
  const desiredOrder = [openBefore[2], openBefore[0], openBefore[1], ...openBefore.slice(3)];
  const revBefore = Number(sandbox.getDataRev_());
  const reorderRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'reorder_tasks',
        sessionToken: token,
        block: 'Открытие',
        orderedIds: desiredOrder
      })
    }
  }).getContent());

  assert.equal(reorderRes.ok, true);
  assert.equal(reorderRes.block, 'Открытие');
  assert.ok(Number(reorderRes.rev) >= revBefore, 'DATA_REV must bump on reorder');

  // Verify new order persists on both admin AND public get_checklists (barista terminal source)
  const afterAdmin = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const openAfter = afterAdmin.tasks.filter((t) => t.block === 'Открытие').map((t) => t.id);
  const closeAfter = afterAdmin.tasks.filter((t) => t.block === 'Закрытие').map((t) => t.id);
  assert.deepEqual(Array.from(openAfter), Array.from(desiredOrder));
  assert.deepEqual(Array.from(closeAfter), Array.from(closeBefore));

  const staffBoot = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'staff_bootstrap', sessionToken: token }) } }).getContent());
  const bootTasks = staffBoot.tasks || (staffBoot.checklists && staffBoot.checklists['Открытие']) || [];
  const bootOpen = bootTasks.filter((t) => !t.block || t.block === 'Открытие').map((t) => t.id);
  assert.deepEqual(Array.from(bootOpen), Array.from(desiredOrder));
});

test('GAS save_task update bumps DATA_REV immediately so barista terminals receive edits', () => {
  const { sandbox, token } = createGasEnv();
  const adm = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const firstTask = adm.tasks[0];
  const revBefore = Number(sandbox.getDataRev_());

  const upd = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_task',
        sessionToken: token,
        id: firstTask.id,
        block: firstTask.block,
        title: firstTask.title + ' (обновлено)',
        instruction: firstTask.instruction,
        photo: 'да'
      })
    }
  }).getContent());

  assert.equal(upd.ok, true);
  assert.ok(Number(upd.rev) >= revBefore, 'save_task update must return bumped DATA_REV');
});

test('Dashboard UI: Sales & Finances have per-column sorting on every table and Checklists have full controls + task reordering', () => {
  const dash = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  const cs = fs.readFileSync(path.join(rootDir, 'js/cloud-sync.js'), 'utf8');

  // Sales Top Products: all 6 columns sortable
  for (const col of ['name', 'kind', 'qty', 'sum', 'share', 'avgPrice']) {
    assert.ok(dash.includes(`sortTh('salesTop','${col}'`), `Missing salesTop sortable header for ${col}`);
  }
  // Sales Log: all 6 columns sortable
  for (const col of ['date', 'barista', 'name', 'kind', 'qty', 'sum']) {
    assert.ok(dash.includes(`sortTh('salesLog','${col}'`), `Missing salesLog sortable header for ${col}`);
  }
  // Finances Cash Shifts: all 6 columns sortable
  for (const col of ['date', 'revenue', 'checks', 'avgCheck', 'cash', 'barista']) {
    assert.ok(dash.includes(`sortTh('finCash','${col}'`), `Missing finCash sortable header for ${col}`);
  }
  // Finances Plans: all 5 columns sortable
  for (const col of ['dayIdx', 'rev', 'checks', 'avg', 'roster']) {
    assert.ok(dash.includes(`sortTh('finPlans','${col}'`), `Missing finPlans sortable header for ${col}`);
  }
  // Finances Expenses: sort pills
  assert.match(dash, /data-sort-tbl="finExp"/);

  // Checklists: every block has Окно + Задачи + Открыть/Вернуть окно unconditionally
  assert.ok(!dash.includes('${!b.isCash ? `<button class="chip-btn" data-vt='), 'Задачи button must be visible on ALL blocks');
  assert.match(dash, /data-eb="\$\{esc\(b\.id\)\}"/);
  assert.match(dash, /data-vt="\$\{esc\(b\.name\)\}"/);
  assert.match(dash, /data-un="\$\{esc\(b\.name\)\}"/);
  assert.match(dash, /data-lk="\$\{esc\(b\.name\)\}"/);

  // Task modal: move up / down + edit + delete + add
  assert.match(dash, /data-mv-up="\$\{esc\(t\.id\)\}"/);
  assert.match(dash, /data-mv-dn="\$\{esc\(t\.id\)\}"/);
  assert.match(dash, /function moveTaskInBlock/);
  assert.match(cs, /reorderTasks:\s*reorderTasks/);
});
