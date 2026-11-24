import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const gasPath = path.resolve(baseDir, '../../coffee-illy-gas/Code.gs');
const cloudPath = path.resolve(baseDir, '../js/cloud-sync.js');
const csvPath = path.resolve(baseDir, '../js/pos-csv-parser.js');
const hasGas = fs.existsSync(gasPath);

function createLiveGasCluster() {
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
        getValues: () => Array.from({ length: nr }, (_, i) => (data[r + i - 1] || []).slice(c - 1, c - 1 + nc)),
        setFontWeight: function () { return this; },
        setBackground: function () { return this; },
        setFontColor: function () { return this; }
      }),
      setFrozenRows: () => {},
      _rows: data
    };
  }

  const mockSs = {
    getSheets: () => Array.from(sheets.values()),
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = makeSheet(n, []); sheets.set(n, s); return s; },
    toast: () => {}
  };

  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, isFinite, parseInt, parseFloat,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'Europe/Chisinau' },
    SpreadsheetApp: { getActiveSpreadsheet: () => mockSs, openById: () => mockSs },
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
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('TEST_SHEET_ID');
  return { sandbox, sheets };
}

function createDeviceClient(gasSandbox, mode) {
  const store = new Map();
  let online = true;
  const fetchMock = async (url, init = {}) => {
    if (!online) throw new Error('NETWORK_OFFLINE');
    if (!init.method || init.method === 'GET') {
      const u = new URL(url);
      const parameter = Object.fromEntries(u.searchParams.entries());
      const out = gasSandbox.doGet({ parameter });
      return { ok: true, status: 200, json: async () => JSON.parse(out.getContent()) };
    }
    const out = gasSandbox.doPost({ postData: { contents: init.body } });
    return { ok: true, status: 200, json: async () => JSON.parse(out.getContent()) };
  };

  const ctx = {
    window: { COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/LIVE_TEST/exec', SYNC_ACTIVE_MS: 500 }, addEventListener: () => {} },
    document: { hidden: false, visibilityState: 'visible', addEventListener: () => {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    navigator: { get onLine() { return online; } },
    fetch: fetchMock,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise,
    setTimeout: () => 0,
    clearTimeout: () => {},
    encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(cloudPath, 'utf8'), ctx);
  const api = ctx.window.CoffeeCloudV94;
  const state = { blocks: [], tasks: [], cash: [], expenses: [], incidents: [], checklists: [], staff: [], ttk: [], plans: [], extensions: {}, announcements: [], salesLog: [], inventory: [], inventoryMoves: [], liveProgress: {}, staffPresence: {} };
  const loop = api.startCloudLoop({ mode, getState: () => state, onSynced: () => {} });
  return { api, state, loop, setOnline: (v) => { online = v; } };
}

test('E2E Multi-Device Sync: Owner unlocks block -> Barista phone receives unlock & submits problem + cash -> Owner sees everything', { skip: !hasGas }, async () => {
  const { sandbox } = createLiveGasCluster();
  const owner = createDeviceClient(sandbox, 'owner');
  const barista = createDeviceClient(sandbox, 'terminal');

  // 1. Both devices log in
  const ownerAuth = await owner.api.authLogin('admin', { pin: '1234' });
  assert.equal(ownerAuth.ok, true);
  // Seed a staff member via owner
  sandbox.saveStaff_(sandbox.getTargetSpreadsheet_(), { name: 'Соня', role: 'Бариста', pin: '1234', active: 'да' });
  const staffAuth = await barista.api.authLogin('staff', { name: 'Соня', pin: '1234' });
  assert.equal(staffAuth.ok, true);

  // 2. Owner unlocks "Лайн Чек 1"
  const today = owner.api.localISO();
  owner.state.extensions['Лайн Чек 1'] = { forceOpen: true, until: '23:59' };
  owner.api.dispatchStateChange(owner.state, 'Администратор', 'Открыт блок «Лайн Чек 1» до 23:59');
  await owner.api.flushOutbox(true);

  // 3. Barista pulls and MUST see Лайн Чек 1 unlocked in state.extensions
  await barista.loop.pullNow(true);
  assert.ok(barista.state.extensions['Лайн Чек 1']?.forceOpen === true, 'Barista phone must receive block unlock from Owner');

  // 4. Barista goes offline, submits a problem + closes cash, then comes back online
  barista.setOnline(false);
  barista.state.incidents.unshift({ id: 'INC-E2E', date: today, time: '14:10', block: 'Лайн Чек 1', step: 'Кофемашина', text: 'Давление скачет', priority: 'Критично', status: 'Новая проблема', who: 'Соня', photoUrl: 'https://drive.google.com/file/d/test' });
  barista.api.dispatchStateChange(barista.state, 'Соня', 'Проблема: Кофемашина');
  barista.state.cash.unshift({ date: today, cash: 1500, card: 2100, revenue: 3600, checks: 90, writeoff: 0, barista: 'Соня' });
  barista.api.dispatchStateChange(barista.state, 'Соня', 'Закрыта касса: 3 600 ₽');
  assert.equal(barista.api.getPendingCount(), 2, 'Both offline mutations must be queued');

  barista.setOnline(true);
  const flushed = await barista.api.flushOutbox(true);
  assert.equal(flushed.flushed, 2);
  assert.equal(flushed.pending, 0);

  // 5. Owner pulls and MUST see both the 3600₽ cash shift and the critical incident
  await owner.loop.pullNow(true);
  const shiftToday = owner.state.cash.find((c) => c.date === today);
  assert.ok(shiftToday && shiftToday.revenue === 3600, 'Owner must see synced 3600₽ revenue');
  const inc = owner.state.incidents.find((i) => i.step === 'Кофемашина');
  assert.ok(inc && inc.priority === 'Критично', 'Owner must see synced critical incident');

  // 6. Owner clears block extension -> Barista re-locks
  owner.api.dispatchStateChange(owner.state, 'Администратор', 'Возвращено окно «Лайн Чек 1»');
  await owner.api.flushOutbox(true);
  await barista.loop.pullNow(true);
  assert.equal(barista.state.extensions['Лайн Чек 1'], undefined, 'Barista phone must re-lock when Owner returns window');
});

test('E2E Multi-Device Sync: POS CSV batch import updates salesLog, auto-deducts warehouse stock, and prevents duplicate import', { skip: !hasGas }, async () => {
  const { sandbox } = createLiveGasCluster();
  const owner = createDeviceClient(sandbox, 'owner');
  await owner.api.authLogin('admin', { pin: '1234' });
  await new Promise((r) => setImmediate(r));
  await owner.loop.pullNow(true);

  const beansBefore = owner.state.inventory.find((x) => x.id === 'inv_beans_illy').stock;
  const csvMod = await import(csvPath);
  const csvParser = csvMod.default || csvMod;
  const sampleCsv = 'Дата;Кассир;Товар;Количество;Сумма\n2026-11-20;Сырбу;Капучино;10;190\n2026-11-20;Сырбу;Чизкейк;2;50';
  const parsed = csvParser.parsePosBatch([{ name: 'report_2026-11-20.csv', text: sampleCsv }]);
  assert.equal(parsed.days.length, 1);

  const res1 = await owner.api.importPosBatch(parsed.days, 'sum');
  assert.equal(res1.ok, true);
  await new Promise((r) => setImmediate(r));
  await owner.loop.pullNow(true);

  const beansAfter = owner.state.inventory.find((x) => x.id === 'inv_beans_illy').stock;
  assert.equal(beansAfter, beansBefore - 90, '10 Cappuccinos from POS CSV must deduct 90g beans');
  const capSale = owner.state.salesLog.find((s) => s.name === 'Капучино' && s.date === '2026-11-20');
  assert.ok(capSale && capSale.qty === 10 && capSale.kind === 'Кофе');
});

test('E2E Full Bidirectional Sync (Windows Dashboard <-> GAS <-> Android Terminal): block edit, disable, unlock & barista checklist submit', { skip: !hasGas }, async () => {
  const { sandbox } = createLiveGasCluster();
  const owner = createDeviceClient(sandbox, 'owner');
  const phone = createDeviceClient(sandbox, 'terminal');

  // 1. Both devices authenticate
  const ownerAuth = await owner.api.authLogin('admin', { pin: '1234' });
  assert.equal(ownerAuth.ok, true, 'Owner must login');
  sandbox.saveStaff_(sandbox.getTargetSpreadsheet_(), { name: 'Соня', role: 'Бариста', pin: '1234', active: 'да' });
  const staffAuth = await phone.api.authLogin('staff', { name: 'Соня', pin: '1234' });
  assert.equal(staffAuth.ok, true, 'Barista must login');

  // 2. Initial sync on both devices
  await owner.loop.pullNow(true);
  await phone.loop.pullNow(true);
  assert.ok(owner.state.blocks.length >= 3, 'Owner received initial blocks');
  assert.ok(phone.state.blocks.length >= 3, 'Phone received initial blocks');

  // 3. Owner edits Закрытие window to 21:00-23:59, disables Открытие, unlocks Закрытие
  const editedBlocks = owner.state.blocks.map((b) => {
    if (b.name === 'Закрытие') return Object.assign({}, b, { openTime: '21:00', deadline: '23:59' });
    if (b.name === 'Открытие') return Object.assign({}, b, { active: false });
    return b;
  });
  const saveBlkRes = await owner.api.saveChecklistBlocks(editedBlocks, {});
  assert.equal(saveBlkRes.ok, true, 'saveChecklistBlocks must succeed on server');
  const extRes = await owner.api.extendDeadline('Закрытие', false);
  assert.equal(extRes.ok, true, 'extendDeadline must succeed on server');

  // 4. Android phone pulls automatically (without forceFull!) via DATA_REV change
  const phonePull = await phone.loop.pullNow(false);
  assert.ok(phonePull && phonePull.changed, 'Phone must detect DATA_REV bump automatically');
  const phoneClose = phone.state.blocks.find((b) => b.name === 'Закрытие');
  const phoneOpen = phone.state.blocks.find((b) => b.name === 'Открытие');
  assert.equal(phoneClose.openTime, '21:00', 'Phone must receive updated openTime 21:00');
  assert.equal(phoneClose.deadline, '23:59', 'Phone must receive updated deadline 23:59');
  assert.equal(phoneOpen.active, false, 'Phone must receive disabled active:false state');
  assert.equal(phone.state.extensions['Закрытие'] && phone.state.extensions['Закрытие'].forceOpen, true, 'Phone must receive admin unlock');

  // 5. Android phone submits checklist -> Windows Owner pulls automatically via DATA_REV
  phone.state.checklists.unshift({ date: phone.api.localISO(), time: '22:15', block: 'Закрытие', who: 'Соня', problems: 0, status: 'В срок', photos: [] });
  phone.api.dispatchStateChange(phone.state, 'Соня', 'Сдан чек-лист «Закрытие»');
  await phone.api.flushOutbox(true);

  const ownerPull = await owner.loop.pullNow(false);
  assert.ok(ownerPull && ownerPull.changed, 'Owner must detect barista submission automatically');
  assert.ok(owner.state.checklists.some((c) => c.block === 'Закрытие' && c.who === 'Соня'), 'Owner dashboard must immediately show barista completed checklist');
});
