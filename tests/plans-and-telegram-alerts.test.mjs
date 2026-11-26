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
  sandbox.saveSetting_(ss, { id: 'TG_NOTIFY_PRE_START', value: 'да' });
  sandbox.saveSetting_(ss, { id: 'TG_QUIET_END', value: '06:00' });
  sandbox.saveSetting_(ss, { id: 'TG_NOTIFY_COOLDOWN_MIN', value: '0' });
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
  assert.ok(tgMessages.some((m) => m.body.chat_id === '2000002' && /До дедлайна (?:чек-листа )?«Открытие» осталось 15 мин/.test(m.body.text)), 'Must send 15m pre-deadline alert for Открытие');
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

test('v98.7.0 Anti-Spam & Zero False Overdue: quiet hours block 05:47 alerts, simultaneous blocks group into 1 message, completed drafts never trigger overdue', () => {
  const { sandbox, ss, token, tgMessages: tgCalls } = createGasEnvWithTelegram();
  // Seed 3 blocks all opening at 06:00-11:00
  sandbox.saveChecklistBlocks_(ss, {
    blocks: [
      { id: 'b1', name: 'Открытие', openTime: '06:00', deadline: '11:00', active: true },
      { id: 'b2', name: 'Лайн Чек 1', openTime: '06:00', deadline: '11:00', active: true },
      { id: 'b3', name: 'Лайн Чек 2', openTime: '06:00', deadline: '21:00', active: true }
    ]
  });

  // 1. At 05:47 AM, quiet hours (default 07:30) MUST block all morning spam
  tgCalls.length = 0;
  const r547 = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-25', overrideTime: '05:47', overrideWeekday: 'Ср' });
  assert.equal(r547.quietHours, true);
  assert.equal(tgCalls.length, 0, 'Must NOT wake barista up at 05:47 AM');

  // 2. At 08:00 AM (after quiet hours), all 3 open blocks MUST be grouped into ONE single Telegram message per barista (not 3!)
  tgCalls.length = 0;
  const r800 = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-25', overrideTime: '08:00', overrideWeekday: 'Ср' });
  assert.equal(r800.sent.length >= 3, true);
  const uniqueChats = new Set(tgCalls.map((c) => c.body.chat_id));
  assert.equal(tgCalls.length, uniqueChats.size, 'All 3 simultaneous blocks must be grouped into 1 Telegram message per barista');

  // 3. Mark Открытие completed in drafts (even if sheet read lags) & Лайн Чек 1 in Чек-листы -> NO false overdue at 11:02!
  sandbox.setJsonProp_('COFFEE_USER_DRAFTS_JSON', { '2026-11-25::Алина::Открытие': { completed: true, date: '2026-11-25', userName: 'Алина', block: 'Открытие', updatedAt: '2026-11-25T10:15:00Z' } });
  ss.getSheetByName('Чек-листы').appendRow(['2026-11-25', '10:20', 'Лайн Чек 1', 'Алина', 0, '[]', '11:00', 'В срок']);
  tgCalls.length = 0;
  const ov = sandbox.cronCheckDeadlinesAndDigest({ ss, overrideDate: '2026-11-25', overrideTime: '11:02', overrideWeekday: 'Ср' });
  assert.equal(ov.overdueSent.some((x) => x.block === 'Открытие' || x.block === 'Лайн Чек 1'), false, 'Completed blocks must NEVER trigger false overdue');
});

test('v98.7.0 Terminal & Dashboard Notification Controls, Anti-Spam Cooldown, Grouped Overdue & Completed Checklist Marking', () => {
  const { sandbox, ss, token, tgMessages } = createGasEnvWithTelegram();

  // 1. Seed 2 blocks opening at 08:00-11:00 and 1 block opening at 08:10-12:00
  sandbox.saveChecklistBlocks_(ss, {
    blocks: [
      { id: 'b1', name: 'Открытие', openTime: '08:00', deadline: '11:00', active: true },
      { id: 'b2', name: 'Лайн Чек 1', openTime: '08:00', deadline: '11:00', active: true },
      { id: 'b3', name: 'Лайн Чек 2', openTime: '08:10', deadline: '12:00', active: true }
    ]
  });

  // 2. Save personal notification prefs for Соня via POST save_staff_notif_prefs (cooldown 30 min, quiet until 08:30)
  const saveRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_staff_notif_prefs',
        sessionToken: token,
        staffName: 'Соня',
        enabled: true,
        onOpen: true,
        preDeadline: true,
        overdue: true,
        preStart: false,
        quietEnd: '08:30',
        quietStart: '22:00',
        cooldownMin: 30
      })
    }
  }).getContent());
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.prefs.quietEnd, '08:30');
  assert.equal(saveRes.prefs.cooldownMin, 30);

  // 3. At 08:05 on Ср (Алина + Соня): Алина gets 1 grouped open message (Открытие + Лайн Чек 1), Соня is protected by her personal quiet hours (until 08:30)!
  tgMessages.length = 0;
  const r805 = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-25', overrideTime: '08:05', overrideWeekday: 'Ср' });
  assert.equal(r805.sent.some((x) => x.staff === 'Алина'), true);
  assert.equal(r805.sent.some((x) => x.staff === 'Соня'), false, 'Соня must be protected by personal quietEnd 08:30');
  assert.equal(tgMessages.length, 1, 'Алина must receive 1 grouped message, not 2');

  // 4. At 08:15 (only 10 min after 08:05): Лайн Чек 2 opens, but Алина has 30m anti-spam cooldown -> skipped!
  tgMessages.length = 0;
  const r815 = sandbox.checkAndNotifyChecklistWindows_(ss, { overrideDate: '2026-11-25', overrideTime: '08:15', overrideWeekday: 'Ср' });
  assert.equal(r815.sent.some((x) => x.staff === 'Алина' && x.block === 'Лайн Чек 2'), false, '30m cooldown must prevent back-to-back non-urgent spam');
  assert.equal(r815.skipped.some((x) => x.staff === 'Алина' && x.reason === 'cooldown_active'), true);

  // 5. At 11:02: BOTH Открытие and Лайн Чек 1 are overdue -> Admin gets 1 grouped alert, each barista gets 1 grouped alert (NOT 2 separate messages!)
  tgMessages.length = 0;
  const ov = sandbox.cronCheckDeadlinesAndDigest({ ss, overrideDate: '2026-11-25', overrideTime: '11:02', overrideWeekday: 'Ср' });
  assert.equal(ov.ok, true);
  const adminMsgs = tgMessages.filter((m) => m.body.chat_id === '1000001');
  const alinaMsgs = tgMessages.filter((m) => m.body.chat_id === '2000002' && /Просрочен/.test(m.body.text));
  const sonyaMsgs = tgMessages.filter((m) => m.body.chat_id === '2000003' && /Просрочен/.test(m.body.text));
  assert.equal(adminMsgs.length, 1, 'Admin must get 1 consolidated overdue message for 2 blocks');
  assert.equal(alinaMsgs.length, 1, 'Алина must get 1 consolidated overdue message for 2 blocks');
  assert.equal(sonyaMsgs.length, 1, 'Соня must get 1 consolidated overdue message for 2 blocks');

  // 6. Verify Terminal, Dashboard & CloudSync UI/sync controls exist
  const idxHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const dashHtml = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  const csJs = fs.readFileSync(path.join(rootDir, 'js/cloud-sync.js'), 'utf8');
  assert.match(idxHtml, /id="b-notif"/, 'Terminal must have 🔔 notification settings button');
  assert.match(idxHtml, /saveStaffNotifPrefs/, 'Terminal must save personal notification prefs to server');
  assert.match(idxHtml, /function findDoneToday/, 'Terminal must normalize completed checklist matching');
  assert.match(dashHtml, /id="tg-n-cool"/, 'Dashboard must have anti-spam cooldown selector');
  assert.match(dashHtml, /✓ Пройден/, 'Dashboard getBlkSt must show completed status instead of false Closed/Overdue');
  assert.match(csJs, /saveStaffNotifPrefs:\s*saveStaffNotifPrefs/, 'CloudSync must export saveStaffNotifPrefs');
  assert.match(csJs, /_pendingSync:\s*true/, 'CloudSync must preserve pending submit_checklist ops on merge');
});

test('v98.7.0 Weekly Plans: preserves 0 (Day Off) in GAS & CloudSync, computes period totals across all calendar days, and provides bulk week editor', () => {
  const { sandbox, token } = createGasEnvWithTelegram();
  const saveRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'save_daily_plans',
        sessionToken: token,
        plans: {
          'Пн': { revenue: 3000, checks: 90, avgCheck: 35 },
          'Вс': { revenue: 0, checks: 0, avgCheck: 0 }
        },
        roster: {
          'Пн': 'Соня (07:00–21:00)',
          'Вс': 'Выходной'
        }
      })
    }
  }).getContent());
  assert.equal(saveRes.ok, true);
  assert.equal(saveRes.dailyPlans['Пн'].revenue, 3000);
  assert.equal(saveRes.dailyPlans['Вс'].revenue, 0, 'Day Off revenue 0 must NOT be overwritten with 2200');
  assert.equal(saveRes.dailyPlans['Вс'].checks, 0, 'Day Off checks 0 must NOT be overwritten with 75');

  // Re-read via admin payload (reads from Планы sheet!) -> Вс MUST stay 0!
  const adm = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'admin', sessionToken: token }) }
  }).getContent());
  assert.equal(adm.dailyPlans['Вс'].revenue, 0, 'Reading Планы sheet must preserve 0 for Day Off');
  assert.equal(adm.shiftRoster['Вс'], 'Выходной');

  const dashHtml = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  assert.match(dashHtml, /function computePeriodPlan/, 'Dashboard must compute plan across all calendar days in selected period');
  assert.match(dashHtml, /id="btn-edit-week-plans"/, 'Dashboard must provide bulk week plan editor');
  assert.match(dashHtml, /id="ph-custom"/, 'Dashboard must allow custom shift hours');
});

test('75) v98.7.0: Зарплата и табель, сверка наличных + фото Z-отчёта и QC фото чек-листов (Принято / Переделать)', () => {
  const gasCode = fs.readFileSync(path.resolve(process.cwd(), 'gas/Code.gs'), 'utf8');
  const syncCode = fs.readFileSync(path.resolve(process.cwd(), 'js/cloud-sync.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');

  // GAS backend routes & handlers
  assert.ok(gasCode.includes("action === 'save_payroll_rate'"), 'GAS missing save_payroll_rate route');
  assert.ok(gasCode.includes("action === 'review_checklist_photo'"), 'GAS missing review_checklist_photo route');
  assert.ok(gasCode.includes('function savePayrollRate_('), 'GAS missing savePayrollRate_');
  assert.ok(gasCode.includes('function saveCashMetaAndAlert_('), 'GAS missing saveCashMetaAndAlert_');
  assert.ok(gasCode.includes('function reviewChecklistPhoto_('), 'GAS missing reviewChecklistPhoto_');
  assert.ok(gasCode.includes('payrollRates: getPayrollRatesMap_()'), 'getAdmin_ missing payrollRates');
  assert.ok(gasCode.includes('cashMeta: getCashMetaMap_()'), 'getAdmin_ missing cashMeta');
  assert.ok(gasCode.includes('photoReviews: getPhotoReviewsMap_()'), 'getAdmin_ missing photoReviews');

  // cloud-sync.js exports & wiring
  assert.ok(syncCode.includes('async function savePayrollRate('), 'cloud-sync missing savePayrollRate');
  assert.ok(syncCode.includes('async function reviewChecklistPhoto('), 'cloud-sync missing reviewChecklistPhoto');
  assert.ok(syncCode.includes('zPhotoUrl'), 'cloud-sync missing zPhotoUrl');
  assert.ok(syncCode.includes('cashDiff'), 'cloud-sync missing cashDiff');

  // Terminal index.html cash reconciliation & Z-report photo
  assert.ok(idxHtml.includes('id="c-open"'), 'index.html missing c-open');
  assert.ok(idxHtml.includes('id="c-enc"'), 'index.html missing c-enc');
  assert.ok(idxHtml.includes('id="c-fact"'), 'index.html missing c-fact');
  assert.ok(idxHtml.includes('id="c-diff-badge"'), 'index.html missing c-diff-badge');
  assert.ok(idxHtml.includes('id="c-zphoto-btn"'), 'index.html missing c-zphoto-btn');

  // Dashboard UI: Payroll, Z-report + diff, Photo QC
  assert.ok(dashHtml.includes('Табель и расчёт зарплаты'), 'dashboard.html missing Payroll card');
  assert.ok(dashHtml.includes('data-pr-edit='), 'dashboard.html missing payroll edit button');
  assert.ok(dashHtml.includes('data-pr-pay='), 'dashboard.html missing payroll pay button');
  assert.ok(dashHtml.includes('mv-qc-approve'), 'dashboard.html missing Photo QC approve button');
  assert.ok(dashHtml.includes('mv-qc-rework'), 'dashboard.html missing Photo QC rework button');
  assert.ok(dashHtml.includes('🧾 Z'), 'dashboard.html missing Z-report photo button');
});

test('76) v98.7.0: Переименование в ILLY, эмодзи-фавикон ☕, сдвоенные смены в табеле и автозаявка поставщикам со склада', () => {
  const gasCode = fs.readFileSync(path.resolve(process.cwd(), 'gas/Code.gs'), 'utf8');
  const syncCode = fs.readFileSync(path.resolve(process.cwd(), 'js/cloud-sync.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  const ownHtml = fs.readFileSync(path.resolve(process.cwd(), 'owner.html'), 'utf8');

  // 1. Default location renamed to ILLY
  assert.ok(!idxHtml.includes('>Кофейня №1<') && !idxHtml.includes('"Кофейня №1"'), 'index.html still displays Кофейня №1');
  assert.ok(!dashHtml.includes('>Кофейня №1<') && !dashHtml.includes('"Кофейня №1"'), 'dashboard.html still displays Кофейня №1');
  assert.ok(idxHtml.includes('>ILLY<'), 'index.html missing ILLY header');
  assert.ok(dashHtml.includes('>ILLY<'), 'dashboard.html missing ILLY header');

  // 2. Coffee emoji favicon + title on all HTML pages
  for (const [name, html] of [['index.html', idxHtml], ['dashboard.html', dashHtml], ['owner.html', ownHtml]]) {
    assert.ok(html.includes('rel="icon" type="image/svg+xml"') && html.includes('%E2%98%95'), name + ' missing coffee emoji SVG favicon');
    assert.ok(html.includes('<title>☕ ILLY'), name + ' missing ☕ ILLY title');
  }

  // 3. Double shifts (secondBarista) in Terminal, CloudSync, GAS, and Dashboard Payroll
  assert.ok(idxHtml.includes('id="c-barista2"'), 'index.html missing c-barista2 selector');
  assert.ok(syncCode.includes('secondBarista'), 'cloud-sync.js missing secondBarista');
  assert.ok(syncCode.includes("desc.indexOf('Выплата зарплаты') === 0"), 'cloud-sync.js missing salary expense sync');
  assert.ok(gasCode.includes('secondBarista: secBar'), 'gas/Code.gs missing secondBarista persistence');
  assert.ok(dashHtml.includes('doubleShifts'), 'dashboard.html missing doubleShifts payroll calc');
  assert.ok(dashHtml.includes("if (tab === 'warehouse' || tab === 'settings')"), 'dashboard.html should show date bar on team tab');

  // 4. Supplier auto-order modal in Warehouse
  assert.ok(dashHtml.includes('id="wh-order-btn"'), 'dashboard.html missing wh-order-btn');
  assert.ok(dashHtml.includes('Автозаявка поставщикам'), 'dashboard.html missing supplier order modal');
  assert.ok(dashHtml.includes('id="ord-copy"') && dashHtml.includes('id="ord-tg"'), 'dashboard.html missing copy/TG order buttons');
});

test('77) v98.7.0: Интерактивное погружение по клику на столбик графика (день / неделя / месяц)', () => {
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  assert.ok(dashHtml.includes('data-bar-idx='), 'dashboard.html missing clickable data-bar-idx on bars');
  assert.ok(dashHtml.includes('const openChartBucketModal = (pt) =>'), 'dashboard.html missing openChartBucketModal');
  assert.ok(dashHtml.includes('id="bar-drill-apply"'), 'dashboard.html missing apply period button');
  assert.ok(dashHtml.includes('id="bar-drill-days"'), 'dashboard.html missing break-down-by-days button');
  assert.ok(dashHtml.includes('monthNamesRuFull'), 'dashboard.html missing full month titles for drill-down');
});

test('78) v98.7.0: Перетаскивание (Drag-and-Drop + touch) для порядка самих чек-листов и задач внутри них', () => {
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  assert.ok(dashHtml.includes('function bindDragSort('), 'dashboard.html missing bindDragSort helper');
  assert.ok(dashHtml.includes('function reorderBlocksById('), 'dashboard.html missing reorderBlocksById');
  assert.ok(dashHtml.includes('function reorderTaskById('), 'dashboard.html missing reorderTaskById');
  assert.ok(dashHtml.includes('id="blk-drag-list"') && dashHtml.includes('data-blk-id='), 'dashboard.html missing draggable checklist blocks');
  assert.ok(dashHtml.includes('id="task-drag-list"') && dashHtml.includes('data-task-id='), 'dashboard.html missing draggable checklist tasks');
  assert.ok(dashHtml.includes('touchstart') && dashHtml.includes('touchmove') && dashHtml.includes('elementFromPoint'), 'dashboard.html missing mobile touch drag support');
});

test('79) v98.7.0: Галерея-карусель фото, разгрузка шапок, поиск по складу, tabular-nums, Esc и нормализация Дашборд · ILLY', () => {
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  const idxHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const syncCode = fs.readFileSync(path.resolve(process.cwd(), 'js/cloud-sync.js'), 'utf8');

  assert.ok(dashHtml.includes("state.location === 'Кофейня №1') state.location = 'ILLY'"), 'dashboard.html missing ILLY normalization');
  assert.ok(idxHtml.includes("state.location === 'Кофейня №1') state.location = 'ILLY'"), 'index.html missing ILLY normalization');
  assert.ok(syncCode.includes("_loc === 'Кофейня №1'"), 'cloud-sync.js missing ILLY normalization');
  assert.ok(dashHtml.includes('data-gal-idx='), 'dashboard.html missing collapsed gallery chip');
  assert.ok(dashHtml.includes('id="mv-prev"') && dashHtml.includes('id="mv-next"'), 'dashboard.html missing carousel prev/next');
  assert.ok(dashHtml.includes('id="wh-search"'), 'dashboard.html missing warehouse search');
  assert.ok(dashHtml.includes('font-variant-numeric: tabular-nums'), 'dashboard.html missing tabular-nums');
  assert.ok(dashHtml.includes("e.key === 'Escape'"), 'dashboard.html missing Esc modal close');
  assert.ok(dashHtml.includes('id="e-add-empty"'), 'dashboard.html missing actionable empty expense state');
  assert.ok(idxHtml.includes('id="prof-theme"') && idxHtml.includes("e.key === 'Escape'"), 'index.html missing profile theme & Esc close');
});

test('80) v98.7.0: Минималистичная камера в стиле iPhone (сетка, tap-to-focus, чипы объективов, переключатель ФОТО/ВИДЕО 15С)', () => {
  const camCode = fs.readFileSync(path.resolve(process.cwd(), 'js/camera.js'), 'utf8');
  const cssCode = fs.readFileSync(path.resolve(process.cwd(), 'css/m3-soft.css'), 'utf8');
  assert.ok(camCode.includes('lg-cam-overlay ios-cam'), 'camera.js missing ios-cam overlay');
  assert.ok(camCode.includes('data-cam="lenses"') && camCode.includes('applyLensZoom'), 'camera.js missing floating lens pills');
  assert.ok(camCode.includes('data-cam="grid"') && camCode.includes('data-cam="focus"'), 'camera.js missing grid & tap-to-focus');
  assert.ok(camCode.includes('data-mode="photo"') && camCode.includes('data-mode="video"'), 'camera.js missing iOS mode switcher');
  assert.ok(cssCode.includes('.lg-cam-shutter.is-recording > span'), 'm3-soft.css missing iOS crimson recording morph');
});

test('81) v98.7.0: Дедупликация объективов камеры (без дублей 1× и Фронт) + отдельная 1-тап кнопка темы Светлая/Тёмная на верхней панели', () => {
  const camCode = fs.readFileSync(path.resolve(process.cwd(), 'js/camera.js'), 'utf8');
  const idxHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const dashHtml = fs.readFileSync(path.resolve(process.cwd(), 'dashboard.html'), 'utf8');
  assert.ok(camCode.includes("state.facingMode === 'user'") && camCode.includes('applyLensZoom'), 'camera.js missing lens deduplication');
  assert.ok(idxHtml.includes('id="btn-theme"') && !idxHtml.includes('id="btn-theme" style="display:none;"'), 'index.html btn-theme must be visible in topbar');
  assert.ok(idxHtml.includes("mode = effTheme() === 'dark' ? 'light' : 'dark'"), 'index.html missing 1-tap dark<->light toggle');
  assert.ok(dashHtml.includes("mode = effTheme() === 'dark' ? 'light' : 'dark'"), 'dashboard.html missing 1-tap dark<->light toggle');
});

test('82) v98.7.0: Переключение объектива/зума камеры работает на текущем потоке без повторного getUserMedia и запроса доступа Telegram', () => {
  const camCode = fs.readFileSync(path.resolve(process.cwd(), 'js/camera.js'), 'utf8');
  assert.ok(camCode.includes('function getZoomCaps()'), 'camera.js missing getZoomCaps');
  assert.ok(camCode.includes('async function applyLensZoom('), 'camera.js missing applyLensZoom');
  assert.ok(camCode.includes('t0.applyConstraints({ advanced: [{ zoom: clamped }] })'), 'camera.js missing hardware zoom applyConstraints');
  assert.ok(camCode.includes('data-zoom="'), 'camera.js missing zero-reprompt data-zoom pills');
  assert.ok(camCode.includes('state.digitalZoom'), 'camera.js missing digital zoom fallback for canvas capture');
});
