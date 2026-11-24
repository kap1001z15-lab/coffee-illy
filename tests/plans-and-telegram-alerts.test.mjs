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

function createGasEnvWithTelegram({ throwOnDeleteAllRows = false } = {}) {
  const sheets = new Map();
  const propsStore = new Map();
  const cacheStore = new Map();
  const tgMessages = [];

  function makeSheet(name) {
    const data = [];
    const sheetObj = {
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
      getDataRange: () => ({
        getValues: () => (data.length ? data.map((r) => r.slice()) : [[]])
      }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        setFontWeight: () => ({ setBackground: () => ({ setFontColor: () => {} }) }),
        setBackground: () => ({ setFontColor: () => {} }),
        setFontColor: () => {},
        clearContent: () => {
          for (let i = 0; i < nr; i++) {
            const ri = r - 1 + i;
            if (data[ri]) {
              for (let j = 0; j < nc; j++) data[ri][c - 1 + j] = '';
            }
          }
          while (data.length > 1 && data[data.length - 1].every((v) => v === '' || v == null)) {
            data.pop();
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
            for (let j = 0; j < vals[i].length; j++) {
              data[ri][c - 1 + j] = vals[i][j];
            }
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
    return sheetObj;
  }

  const ss = {
    getId: () => 'TEST_SHEET_V9712',
    getSheets: () => Array.from(sheets.values()),
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sh = makeSheet(name);
      sheets.set(name, sh);
      return sh;
    }
  };

  const sandbox = {
    console, Logger: { log: () => {} }, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, isFinite,
    SpreadsheetApp: {
      openById: () => ss,
      getActiveSpreadsheet: () => ss
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
        tryLock: () => true,
        waitLock: () => {},
        releaseLock: () => {}
      })
    },
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
        if (fmt === 'dd.MM.yyyy HH:mm') return `${pad(dt.getUTCDate())}.${pad(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
        if (fmt === 'u') return String(dt.getUTCDay() === 0 ? 7 : dt.getUTCDay());
        return dt.toISOString();
      },
      getUuid: () => crypto.randomUUID(),
      base64Decode: (s) => Buffer.from(s, 'base64'),
      newBlob: (b, t, n) => ({ bytes: b, type: t, name: n })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        _txt: txt,
        setMimeType() { return this; },
        getContent() { return this._txt; }
      })
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        const body = JSON.parse((params && params.payload) || '{}');
        tgMessages.push({ url, body });
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, result: { message_id: tgMessages.length } })
        };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gasCodePath, 'utf8'), sandbox, { filename: 'Code.gs' });
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ();
  const login = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '1234' }) } }).getContent());
  const token = login.sessionToken;

  // Configure Telegram bot, admin chat, webappUrl (deliberately ending with dashboard.html to test normalization!)
  const saveTg = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_telegram_settings',
        sessionToken: token,
        tgToken: '999999:TEST_BOT_TOKEN',
        tgChat: '1000001',
        webappUrl: 'https://kap1001z15-lab.github.io/coffee-illy/dashboard.html'
      })
    }
  }).getContent());
  assert.equal(saveTg.ok, true, JSON.stringify({ login, saveTg }));

  // Bind Telegram IDs for Alina and Sonya
  const shStaff = ss.getSheetByName('Сотрудники');
  const rows = shStaff.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const nm = String(rows[i][1] || '').trim();
    if (nm === 'Алина') shStaff.getRange(i + 1, 7).setValue('2000002');
    if (nm === 'Соня') shStaff.getRange(i + 1, 7).setValue('2000003');
  }

  return { sandbox, ss, token, tgMessages, propsStore };
}

test('Weekly Plans: save_daily_plans works atomically without deleteRows crash on frozen 8-row sheet and persists roster + numbers', () => {
  const { sandbox, token } = createGasEnvWithTelegram({ throwOnDeleteAllRows: true });

  const saveRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_daily_plans',
        sessionToken: token,
        plans: {
          'Пн': { revenue: 2650, checks: 82, avgCheck: 34 },
          'Ср': { revenue: 2900, checks: 88, avgCheck: 36 }
        },
        roster: {
          'Пн': 'Лаура Темная (07:30–22:30)',
          'Ср': 'Алина + Соня (2 смены, пик)',
          'Вс': 'Выходной'
        }
      })
    }
  }).getContent());

  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.dailyPlans['Пн'].revenue, 2650);
  assert.equal(saveRes.dailyPlans['Ср'].checks, 88);
  assert.equal(saveRes.shiftRoster['Ср'], 'Алина + Соня (2 смены, пик)');
  assert.equal(saveRes.shiftRoster['Вс'], 'Выходной');

  // Verify persistence when reading back via admin payload
  const adm = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) }
  }).getContent());
  assert.equal(adm.dailyPlans['Пн'].revenue, 2650);
  assert.equal(adm.dailyPlans['Пн'].avgCheck, 34);
  assert.equal(adm.shiftRoster['Пн'], 'Лаура Темная (07:30–22:30)');
  assert.equal(adm.shiftRoster['Ср'], 'Алина + Соня (2 смены, пик)');
  assert.equal(adm.shiftRoster['Вс'], 'Выходной');
});

test('Barista TG Alerts: sends 15m pre-start, open, and 15m pre-deadline alerts personally to scheduled barista(s) with dedup & index.html WebApp URL', () => {
  const { sandbox, ss, tgMessages } = createGasEnvWithTelegram();

  // Set clear block window for Открытие: 07:30 – 08:30
  const shTl = ss.getSheetByName('Таймлайн');
  const tlRows = shTl.getDataRange().getValues();
  for (let i = 1; i < tlRows.length; i++) {
    if (String(tlRows[i][1]).trim() === 'Открытие') {
      shTl.getRange(i + 1, 3).setValue('07:30');
      shTl.getRange(i + 1, 4).setValue('08:30');
    }
  }

  // 1) 15 min BEFORE start (07:15 on Вт -> scheduled barista is Алина, chat 2000002)
  const rPre = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-24', overrideTime: '07:15', overrideWeekday: 'Вт' });
  assert.equal(rPre.ok, true);
  const preOpen = rPre.sent.filter((x) => x.block === 'Открытие' && x.stage === 'pre_start_15');
  assert.equal(preOpen.length, 1);
  assert.equal(preOpen[0].staff, 'Алина');
  assert.equal(preOpen[0].chatId, '2000002');
  const lastPreMsg = tgMessages[tgMessages.length - 1];
  assert.equal(lastPreMsg.body.chat_id, '2000002');
  assert.match(lastPreMsg.body.text, /Скоро начнётся чек-лист: «Открытие»/);
  assert.match(lastPreMsg.body.reply_markup.inline_keyboard[0][0].web_app.url, /\/index\.html\?block=/);

  // Repeat at 07:20 -> deduplicated
  const rPre2 = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-24', overrideTime: '07:20', overrideWeekday: 'Вт' });
  assert.equal(rPre2.sent.filter((x) => x.block === 'Открытие' && x.stage === 'pre_start_15').length, 0);

  // 2) On open (07:35)
  const rOpen = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-24', overrideTime: '07:35', overrideWeekday: 'Вт' });
  assert.equal(rOpen.sent.filter((x) => x.block === 'Открытие' && x.stage === 'open').length, 1);

  // 3) 15 min BEFORE deadline (08:15)
  const rDead = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-24', overrideTime: '08:15', overrideWeekday: 'Вт' });
  const preDead = rDead.sent.filter((x) => x.block === 'Открытие' && x.stage === 'pre_deadline_15');
  assert.equal(preDead.length, 1);
  assert.equal(preDead[0].staff, 'Алина');
  assert.ok(tgMessages.some((m) => m.body.chat_id === '2000002' && /До дедлайна чек-листа «Открытие» осталось 15 мин/.test(m.body.text)), 'Must send 15m pre-deadline alert for Открытие');
  assert.ok(tgMessages.some((m) => m.body.chat_id === '2000002' && /Скоро начнётся чек-лист: «Лайн Чек 1»/.test(m.body.text)), 'Must also send 15m pre-start alert for Лайн Чек 1 at 08:15');

  // 4) Multi-barista shift on Ср ("Алина + Соня (2 смены)") sends to BOTH baristas
  const rTwo = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-25', overrideTime: '07:15', overrideWeekday: 'Ср' });
  const twoSent = rTwo.sent.filter((x) => x.block === 'Открытие' && x.stage === 'pre_start_15');
  assert.equal(twoSent.length, 2);
  assert.deepEqual(Array.from(twoSent, (x) => String(x.staff)).sort(), ['Алина', 'Соня']);
});

test('Overdue Autopilot & Direct TG Routing: overdue alerts go to BOTH admin and barista; direct messages route cleanly to admin or specific barista', () => {
  const { sandbox, ss, token, tgMessages } = createGasEnvWithTelegram();

  // Set Открытие window 07:30–08:30
  const shTl = ss.getSheetByName('Таймлайн');
  const tlRows = shTl.getDataRange().getValues();
  for (let i = 1; i < tlRows.length; i++) {
    if (String(tlRows[i][1]).trim() === 'Открытие') {
      shTl.getRange(i + 1, 3).setValue('07:30');
      shTl.getRange(i + 1, 4).setValue('08:30');
    }
  }

  // Trigger overdue at 08:34 on Вт (like screenshot 2!)
  const cronRes = sandbox.cronCheckDeadlinesAndDigest({ ss, overrideDate: '2026-11-24', overrideTime: '08:34', overrideWeekday: 'Вт' });
  assert.equal(cronRes.ok, true);
  const ovAdmin = cronRes.overdueSent.find((x) => x.block === 'Открытие' && x.recipient === 'admin');
  const ovBarista = cronRes.overdueSent.find((x) => x.block === 'Открытие' && x.recipient === 'Алина');
  assert.ok(ovAdmin && ovAdmin.ok, 'Admin must receive overdue alert');
  assert.ok(ovBarista && ovBarista.ok && ovBarista.chatId === '2000002', 'Scheduled barista Alina must receive personal overdue alert');

  // Admin test message -> chat 1000001 with dashboard.html URL
  const adminTest = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'test_telegram_alert', sessionToken: token }) }
  }).getContent());
  assert.equal(adminTest.ok, true);
  const adminMsg = tgMessages[tgMessages.length - 1];
  assert.equal(adminMsg.body.chat_id, '1000001');
  assert.match(adminMsg.body.reply_markup.inline_keyboard[0][0].url, /\/dashboard\.html$/);

  // Direct personal message to specific barista (Соня -> 2000003)
  const baristaDm = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'send_telegram_alert',
        sessionToken: token,
        targetStaffName: 'Соня',
        text: 'Проверь витрину десертов',
        targetPage: 'index.html',
        buttonType: 'web_app',
        force: true,
        skipDedup: true
      })
    }
  }).getContent());
  assert.equal(baristaDm.ok, true);
  const dmMsg = tgMessages[tgMessages.length - 1];
  assert.equal(dmMsg.body.chat_id, '2000003');
  assert.match(dmMsg.body.text, /Проверь витрину десертов/);

  // Unbound barista returns clear error
  const unboundRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'send_telegram_alert',
        sessionToken: token,
        targetStaffName: 'Настя',
        text: 'Тест',
        force: true
      })
    }
  }).getContent());
  assert.equal(unboundRes.ok, false);
  assert.match(unboundRes.reason, /не привязан Telegram ID/i);
});

test('Dashboard UI & CloudSync integrity: weekly plan 2-barista modal, direct TG sender, and saveDailyPlans API exist', () => {
  const dash = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  const cs = fs.readFileSync(path.join(rootDir, 'js/cloud-sync.js'), 'utf8');
  assert.match(dash, /id="ps2"/, 'Weekly plan modal must support 2nd barista');
  assert.match(dash, /saveDailyPlans\(/, 'Weekly plan modal must call CoffeeCloudV93.saveDailyPlans');
  assert.match(dash, /id="tg-rcpt"/, 'Telegram card must include recipient selector (admin / specific barista)');
  assert.match(dash, /id="tg-direct-send"/, 'Telegram card must include direct send button');
  assert.match(dash, /data-tg-staff=/, 'Team tab must include quick personal TG button per barista');
  assert.match(cs, /saveDailyPlans:\s*saveDailyPlans/, 'cloud-sync.js must export saveDailyPlans');
  assert.match(cs, /sendTelegramAlert:\s*sendTelegramAlert/, 'cloud-sync.js must export sendTelegramAlert');
});
