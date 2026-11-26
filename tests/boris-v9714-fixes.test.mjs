import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const gasCodePath = path.resolve(rootDir, 'gas', 'Code.gs');

function createBorisGasEnv({ throwOnDeleteAllRows = true } = {}) {
  const sheets = new Map();
  const propsStore = new Map();
  const cacheStore = new Map();
  const tgMessages = [];
  const driveSharingCalls = [];

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
      deleteRows: (r, count) => {
        if (throwOnDeleteAllRows && r === 2 && count >= data.length - 1) {
          throw new Error('Cannot delete all non-frozen rows');
        }
        data.splice(r - 1, count);
      },
      getDataRange: () => ({ getValues: () => (data.length ? data.map((r) => r.slice()) : [[]]) }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        setFontWeight: () => ({ setBackground: () => ({ setFontColor: () => {} }) }),
        setBackground: () => ({ setFontColor: () => {} }),
        setFontColor: () => {},
        clearContent: () => {
          for (let i = 0; i < nr; i++) {
            const ri = r - 1 + i;
            if (data[ri]) for (let j = 0; j < nc; j++) data[ri][c - 1 + j] = '';
          }
        },
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
    getId: () => 'TEST_SHEET_V9714',
    getSheets: () => Array.from(sheets.values()),
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => { const sh = makeSheet(name); sheets.set(name, sh); return sh; }
  };

  const mockDriveFiles = [
    { id: 'f1', setSharing: (a, p) => driveSharingCalls.push({ id: 'f1', access: a, perm: p }) },
    { id: 'f2', setSharing: (a, p) => driveSharingCalls.push({ id: 'f2', access: a, perm: p }) }
  ];

  const sandbox = {
    console, Logger: { log: () => {} }, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' },
      getFoldersByName: () => {
        let yielded = false;
        return {
          hasNext: () => !yielded,
          next: () => {
            yielded = true;
            let idx = 0;
            return {
              setSharing: (a, p) => driveSharingCalls.push({ id: 'folder', access: a, perm: p }),
              getFiles: () => ({ hasNext: () => idx < mockDriveFiles.length, next: () => mockDriveFiles[idx++] })
            };
          }
        };
      }
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
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        const body = JSON.parse((params && params.payload) || '{}');
        tgMessages.push({ url, body });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: { message_id: tgMessages.length } }) };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gasCodePath, 'utf8'), sandbox, { filename: 'Code.gs' });
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ();
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  return { sandbox, ss, token: login.sessionToken, tgMessages, driveSharingCalls };
}

test('Boris Fix #2: save_checklist_blocks renames block + updates deadlines atomically without deleteRows crash and cascades rename to Задачи', () => {
  const { sandbox, token } = createBorisGasEnv({ throwOnDeleteAllRows: true });

  // Seed a task in Лайн Чек 1
  sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'save_task', sessionToken: token, id: 'd01', block: 'Лайн Чек 1', title: 'Проверка молока', photo: 'да' }) } });

  const admBefore = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const blocks = admBefore.checklistBlocks.map((b) => {
    if (b.name === 'Лайн Чек 1') {
      return { ...b, name: 'Дневной обход 1', openTime: '09:00', deadline: '11:30', assignee: 'Алина', scheduleType: 'weekly', scheduleDays: ['Вт', 'Чт'] };
    }
    return b;
  });

  const saveRes = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'save_checklist_blocks', sessionToken: token, blocks, renamedBlocks: { 'Лайн Чек 1': 'Дневной обход 1' } }) }
  }).getContent());
  assert.equal(saveRes.ok, true);

  const admAfter = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const renamed = admAfter.checklistBlocks.find((b) => b.name === 'Дневной обход 1');
  assert.ok(renamed, 'Renamed block must persist');
  assert.equal(renamed.openTime, '09:00');
  assert.equal(renamed.deadline, '11:30');
  assert.equal(renamed.assignee, 'Алина');
  assert.deepEqual(Array.from(renamed.scheduleDays), ['Вт', 'Чт']);

  const movedTask = admAfter.tasks.find((t) => t.id === 'd01');
  assert.equal(movedTask.block, 'Дневной обход 1', 'Task block must cascade on rename');
});

test('P1-9 Hardening: Drive photos default to PRIVATE unless ALLOW_PUBLIC_LINK_DRIVE_PHOTOS=1', () => {
  const { sandbox, token, driveSharingCalls } = createBorisGasEnv();
  const mockFile = { setSharing: (a, p) => driveSharingCalls.push({ id: 'new_photo', access: a, perm: p }) };
  const mode = sandbox.applySecureDriveFileSharingV82_(mockFile);
  assert.equal(mode, 'PRIVATE');
  assert.ok(driveSharingCalls.some((c) => c.id === 'new_photo' && c.access === 'PRIVATE' && c.perm === 'NONE'));

  const grantRes = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'grant_photo_reader_access', sessionToken: token }) }
  }).getContent());
  assert.equal(grantRes.ok, true);
  assert.equal(grantRes.updated, 2);
});

test('Boris Fix #4: save_staff updates existing employee by id/oldName (rename, deactivate, PIN change) without duplicating rows', () => {
  const { sandbox, token } = createBorisGasEnv();
  const before = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const countBefore = before.staff.length;
  const alina = before.staff.find((s) => s.name === 'Алина');
  assert.ok(alina);

  // Rename Алина -> Алина К., change PIN to 5921, keep active
  const upd1 = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_staff',
        sessionToken: token,
        id: alina.id,
        oldName: 'Алина',
        name: 'Алина К.',
        role: 'Бариста',
        active: 'да',
        tgId: '2000002',
        pin: '5921'
      })
    }
  }).getContent());
  assert.equal(upd1.ok, true);
  assert.equal(upd1.updated, true);
  assert.equal(upd1.pinUpdated, true);

  // Verify count did NOT increase (no duplicate!) and new PIN logs in cleanly
  const after1 = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  assert.equal(after1.staff.length, countBefore);
  assert.ok(after1.staff.some((s) => s.name === 'Алина К.' && s.id === alina.id));

  const staffLogin = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', staffName: 'Алина К.', pin: '5921' }) }
  }).getContent());
  assert.equal(staffLogin.ok, true, 'Renamed employee must authenticate with newly set PIN');

  // Deactivate Алина К.
  const upd2 = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_staff',
        sessionToken: token,
        id: alina.id,
        oldName: 'Алина К.',
        name: 'Алина К.',
        role: 'Бариста',
        active: 'нет',
        tgId: '2000002'
      })
    }
  }).getContent());
  assert.equal(upd2.ok, true);
  const after2 = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) } }).getContent());
  const deactivated = after2.staff.find((s) => s.id === alina.id);
  assert.equal(deactivated.active, 'нет');
});

test('Boris Fix #5 & #6: Global plan inputs removed from Параметры кофейни; assignee & weekly/date schedules enforced in TG autopilot and UI', () => {
  const { sandbox, ss, token, tgMessages } = createBorisGasEnv();
  // Configure Telegram & bind Alina + Sonya
  sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'save_telegram_settings', sessionToken: token, tgToken: '999:TOK', tgChat: '1000001', webappUrl: 'https://example.com/' }) } });
  const shStaff = ss.getSheetByName('Сотрудники');
  const sRows = shStaff.getDataRange().getValues();
  for (let i = 1; i < sRows.length; i++) {
    if (String(sRows[i][1]).trim() === 'Алина') shStaff.getRange(i + 1, 7).setValue('2000002');
    if (String(sRows[i][1]).trim() === 'Соня') shStaff.getRange(i + 1, 7).setValue('2000003');
  }

  // Create a weekly block assigned ONLY to Соня on Вт (10:00–12:00)
  sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_checklist_blocks',
        sessionToken: token,
        blocks: [
          { id: 'blk_w', name: 'Генуборка склада', openTime: '10:00', deadline: '12:00', isCash: false, active: true, assignee: 'Соня', scheduleType: 'weekly', scheduleDays: ['Вт'] }
        ]
      })
    }
  });

  // Enable pre_start_15 (off by default in v98.3.0)
  sandbox.saveSetting_(ss, { id: 'TG_NOTIFY_PRE_START', value: 'да' });

  // On Ср (not scheduled) -> 0 messages
  const wedRes = sandbox.checkAndNotifyChecklistWindows_(ss, { ignoreQuietHours: true,  overrideDate: '2026-11-25', overrideTime: '09:45', overrideWeekday: 'Ср' });
  assert.equal(wedRes.sent.length, 0);

  // On Вт at 09:45 (-15m before start) -> sent ONLY to Соня (2000003), NOT Алина
  const tueRes = sandbox.checkAndNotifyChecklistWindows_(ss, { ignoreQuietHours: true,  overrideDate: '2026-11-24', overrideTime: '09:45', overrideWeekday: 'Вт' });
  assert.equal(tueRes.sent.length, 1);
  assert.equal(tueRes.sent[0].staff, 'Соня');
  assert.equal(tgMessages[tgMessages.length - 1].body.chat_id, '2000003');

  // Verify dashboard.html removed duplicate global plan dropdowns and added assignee + schedule controls
  const dash = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  assert.ok(!dash.includes('id="sp"'), 'Duplicate global revenue plan dropdown must be removed');
  assert.ok(!dash.includes('id="sc"'), 'Duplicate global checks plan dropdown must be removed');
  assert.ok(!dash.includes('id="sa"'), 'Duplicate global avgCheck plan dropdown must be removed');
  assert.match(dash, /id="m-blk-assignee"/);
  assert.match(dash, /id="m-blk-sched"/);
  assert.match(dash, /id="s-grant-photos"/);
});

test('Deep Audit Regression: zero corrupted control chars in HTML/JS/GAS, valid PIN & TG regexes, and accurate inactive/schedule badge priority', () => {
  const files = [
    path.resolve(process.cwd(), 'dashboard.html'),
    path.resolve(process.cwd(), 'index.html'),
    path.resolve(process.cwd(), 'js/cloud-sync.js'),
    path.resolve(process.cwd(), 'gas/Code.gs')
  ];
  for (const fp of files) {
    const content = fs.readFileSync(fp, 'utf8');
    const bad = content.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
    assert.equal(bad, null, `Corrupted control char found in ${path.basename(fp)}`);
  }
  const dash = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  const idx = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const gas = fs.readFileSync(path.resolve(process.cwd(), 'gas/Code.gs'), 'utf8');
  assert.ok(dash.includes('/^(\\d)\\1{3,}$/'), 'dashboard.html must use valid \\1 backreference for PIN validation');
  assert.ok(idx.includes('/^(\\d)\\1{3,}$/'), 'index.html must use valid \\1 backreference for PIN validation');
  assert.ok(gas.includes('Кофейня — Медиаархив Смен') && gas.includes('cur.getFolders'), 'grantPhotoFolderReaderAccess_ must support legacy folder & subfolders');
  assert.ok(idx.indexOf("code:'off'") < idx.indexOf("code: 'sched'"), 'index.html getBlkSt must check active===false before schedule status');
});

test('Zero-Data-Loss Auto-Migration: upgrading legacy 6-col sheets preserves all user edits, expands headers, hashes legacy PINs, and unlocks Drive photos', () => {
  const { sandbox, ss, driveSharingCalls } = createBorisGasEnv();
  const props = sandbox.PropertiesService.getScriptProperties();
  const shTl = ss.getSheetByName('Таймлайн');
  shTl.clear();
  shTl.appendRow(['ID', 'Название чек-листа', 'Открытие (ЧЧ:ММ)', 'Дедлайн (ЧЧ:ММ)', 'Касса (да/нет)', 'Активен (да/нет)']);
  shTl.appendRow(['blk_open', 'Моё Открытие', '06:45', '08:15', 'нет', 'да']);
  shTl.appendRow(['blk_off', 'Архивный блок', '10:00', '12:00', 'нет', 'нет']);
  sandbox.saveSetting_(ss, { id: 'CHECKLIST_BLOCKS_JSON', value: '' });

  const shSt = ss.getSheetByName('Сотрудники');
  shSt.clear();
  shSt.appendRow(['ID', 'Имя', 'Роль', 'Кофейня', 'Активен', 'Код входа (PIN)']);
  shSt.appendRow(['st_1', 'Алина', 'Бариста', 'Кофейня №1', 'да', '4829']);
  props.deleteProperty('SCHEMA_MIGRATED_VERSION');
  props.deleteProperty('STAFF_PIN_HASH_Алина');
  driveSharingCalls.length = 0;

  const res = sandbox.autoMigrateSchemaIfNeeded_(ss, false);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(props.getProperty('SCHEMA_MIGRATED_VERSION'), 'v98.3.0');

  assert.equal(shTl._data[0].length, 9);
  assert.equal(shTl._data[0][6], 'Сотрудник');
  assert.equal(shTl._data[1][1], 'Моё Открытие');
  assert.equal(shTl._data[1][3], '08:15');
  assert.equal(shSt._data[0][6], 'Telegram ID');

  const map = sandbox.getSettingsMap_(ss);
  const parsed = JSON.parse(map.CHECKLIST_BLOCKS_JSON);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Моё Открытие');
  assert.equal(parsed[0].deadline, '08:15');
  assert.equal(parsed[0].scheduleType, 'daily');
  assert.equal(parsed[1].active, false);

  assert.ok(props.getProperty('STAFF_PIN_HASH_Алина'), 'Legacy PIN must be hashed into ScriptProperties');
  assert.equal(shSt._data[1][1], 'Алина');
  assert.ok(driveSharingCalls.some((c) => c.access === 'ANYONE_WITH_LINK' && c.perm === 'VIEW'));

  const res2 = sandbox.autoMigrateSchemaIfNeeded_(ss, false);
  assert.equal(res2.skipped, true);
});

test('v98.3.0 Production Hardening (F1-F7): try/finally + rollback on async modals, quota-safe polling, pagination, no pin:1234, revokeObjectURL & beforeunload', () => {
  const dash = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  const idx = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const cs = fs.readFileSync(path.resolve(process.cwd(), 'js/cloud-sync.js'), 'utf8');
  const cfg = fs.readFileSync(path.resolve(process.cwd(), 'config.js'), 'utf8');

  assert.ok(dash.includes('const prevBlk = Object.assign'), 'Block modal must snapshot prevBlk for rollback');
  assert.ok(dash.includes('const prevP = Object.assign'), 'Plan modal must snapshot prevP for rollback');
  assert.ok(dash.includes('const rollbackStaff ='), 'Staff modal must roll back on server error');
  assert.ok((dash.match(/finally\s*\{/g) || []).length >= 6, 'All async save/import flows must use finally to re-enable buttons');

  assert.ok(cfg.includes('SYNC_ACTIVE_MS: Number(env.SYNC_ACTIVE_MS) || 2500'), 'config.js must use 2500ms active polling');
  assert.ok(cfg.includes('SYNC_INTERVAL_MS: Number(env.SYNC_INTERVAL_MS) || 3500'), 'config.js must use 3500ms base polling');

  assert.ok(dash.includes("inlineSaveBtn.onclick = () => guard('Импорт CSV в Google Таблицу', () => saveBatchFn(inlineSaveBtn))"), 'CSV import must reuse saveBatchFn');
  assert.ok(dash.includes("btn.textContent = 'Создание...'"), 'New block button must disable during creation');

  assert.ok(dash.includes('chkLogLimit') && dash.includes('id="chk-more"'), 'Checklist history must support pagination');
  assert.ok(dash.includes('const slim = Object.assign({}, st'), 'dashboard.html must trim cached state on QuotaExceededError');

  assert.equal(cs.includes("'1234'"), false, 'cloud-sync.js must not inject fake pin 1234');
  assert.ok(cs.includes('window.CoffeeCloud ='), 'cloud-sync.js must export unified window.CoffeeCloud');

  assert.ok(dash.includes('URL.revokeObjectURL'), 'dashboard.html must revoke CSV blob URL');
  assert.ok(idx.includes('activePhotoUploads') && idx.includes('beforeunload'), 'index.html must warn on beforeunload during active photo uploads');
});

test('P0-2 Hardening: Uninitialized server rejects anonymous 1234 login (SETUP_REQUIRED) until explicit setup, and preserves custom PIN', () => {
  const { sandbox, ss } = createBorisGasEnv();
  const props = sandbox.PropertiesService.getScriptProperties();
  props.deleteProperty('ADMIN_PIN_HASH');
  props.deleteProperty('SCHEMA_MIGRATED_VERSION');
  sandbox.autoMigrateSchemaIfNeeded_(ss, false);
  assert.equal(props.getProperty('ADMIN_PIN_HASH'), null, 'Auto-migration must NOT silently create default 1234 PIN');
  const blocked = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error || ''), /SETUP_REQUIRED/i);

  // Changing admin PIN via save_setting preserves custom PIN across future migrations
  sandbox.saveSetting_(ss, { id: 'ADMIN_PIN', value: '5839' });
  props.deleteProperty('SCHEMA_MIGRATED_VERSION');
  sandbox.autoMigrateSchemaIfNeeded_(ss, false);
  assert.equal(sandbox.verifyPinStored_(props.getProperty('ADMIN_PIN_HASH'), '5839'), true, 'Custom admin PIN must be preserved on migration');

  const dash = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  const cs = fs.readFileSync(path.resolve(process.cwd(), 'js/cloud-sync.js'), 'utf8');
  assert.ok(dash.includes('id="s-change-pin"') && dash.includes('changeAdminPin'), 'dashboard.html must provide admin PIN change UI');
  assert.ok(cs.includes('async function changeAdminPin'), 'cloud-sync.js must export changeAdminPin');
});

test('v98.3.0 Photo Reader Access: grantPhotoFolderReaderAccess_ persists ALLOW_PUBLIC_LINK_DRIVE_PHOTOS=1 so future photos stay readable too', () => {
  const { sandbox, ss } = createBorisGasEnv();
  const res = sandbox.grantPhotoFolderReaderAccess_(ss);
  assert.equal(res.ok, true);
  assert.equal(res.allowPublicLinks, true);
  assert.equal(sandbox.PropertiesService.getScriptProperties().getProperty('ALLOW_PUBLIC_LINK_DRIVE_PHOTOS'), '1', 'Must persist ALLOW_PUBLIC_LINK_DRIVE_PHOTOS=1 for all future uploads');
  const dash = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  assert.match(dash, /id="chk-grant-photos"/, 'Checklist History must expose 1-click reader access button');
});
