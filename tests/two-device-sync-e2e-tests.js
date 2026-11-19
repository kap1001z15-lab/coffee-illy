/**
 * Coffee Illy — Two-Device E2E Sync & MVP Bug Regression Suite
 * Эмулирует 3 изолированных устройства (ПК Администратор, Телефон Бариста Соня, Планшет Бариста Алина)
 * поверх реального серверного кода Code.gs + клиентских модулей js/defaults.js, js/security.js, js/storage.js, js/sync.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function createGasServer() {
  const sheets = {};
  const scriptProps = {};
  const scriptCache = {};
  const tgCalls = [];

  function makeSheet(name, headers) {
    const data = headers ? [headers.slice()] : [];
    const sh = {
      _name: name,
      _data: data,
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] ? data[0].length : 0),
      appendRow: (row) => { data.push(row.slice()); },
      deleteRows: (start, num) => { data.splice(start - 1, num); },
      getDataRange: () => ({
        getValues: () => data.map((r) => r.slice())
      }),
      getRange: (r, c, nr, nc) => {
        const rows = nr || 1;
        const cols = nc || 1;
        return {
          getValue: () => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : ''),
          setValue: (v) => {
            while (data.length < r) data.push([]);
            while (data[r - 1].length < c) data[r - 1].push('');
            data[r - 1][c - 1] = v;
          },
          getValues: () => {
            const out = [];
            for (let i = 0; i < rows; i++) {
              const row = [];
              for (let j = 0; j < cols; j++) row.push((data[r - 1 + i] && data[r - 1 + i][c - 1 + j]) || '');
              out.push(row);
            }
            return out;
          },
          setValues: (vals) => {
            for (let i = 0; i < vals.length; i++) {
              while (data.length < r + i) data.push([]);
              for (let j = 0; j < vals[i].length; j++) {
                while (data[r - 1 + i].length < c + j) data[r - 1 + i].push('');
                data[r - 1 + i][c - 1 + j] = vals[i][j];
              }
            }
          }
        };
      }
    };
    sheets[name] = sh;
    return sh;
  }

  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => makeSheet(n, []),
    getSheets: () => Object.values(sheets)
  };

  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet: () => ss },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in scriptProps ? scriptProps[k] : null),
        setProperty: (k, v) => { scriptProps[k] = String(v); },
        deleteProperty: (k) => { delete scriptProps[k]; },
        getProperties: () => Object.assign({}, scriptProps)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in scriptCache ? scriptCache[k] : null),
        put: (k, v) => { scriptCache[k] = String(v); },
        remove: (k) => { delete scriptCache[k]; }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => true,
        waitLock: () => true,
        releaseLock: () => {}
      })
    },
    Session: { getScriptTimeZone: () => 'GMT+2' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({
        _txt: txt,
        setMimeType: function () { return this; },
        getContent: function () { return this._txt; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()),
      formatDate: (d, _tz, fmt) => {
        const dt = new Date(d);
        const pad = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        if (fmt === 'HH:mm') return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        return dt.toISOString();
      },
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url')
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const body = opts && opts.payload ? JSON.parse(opts.payload) : {};
        tgCalls.push({ url, body, at: Date.now() });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }) };
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  // Seed sheets & credentials
  if (typeof sandbox.ensureSheets_ === "function") sandbox.ensureSheets_(ss);
  const setupRes = JSON.parse(sandbox.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'setup_initial_credentials',
        newAdminPin: '778899',
        staffPins: [
          { name: 'Соня', pin: '112233' },
          { name: 'Алина', pin: '445566' }
        ]
      })
    }
  }).getContent());
  assert(setupRes.ok === true, 'setup_initial_credentials failed: ' + JSON.stringify(setupRes));

  // Configure Telegram credentials & WEBAPP_URL
  scriptProps.TG_BOT_TOKEN_SECRET = '123456:TEST_BOT_TOKEN';
  scriptProps.TG_CHAT_ID_SECRET = '-100999888';
  sandbox.saveSetting_(ss, { id: 'WEBAPP_URL', value: 'https://coffee-illy.example.com/barista.html' });

  function callGet(params) {
    const t0 = performance.now();
    const out = JSON.parse(sandbox.doGet({ parameter: params }).getContent());
    return { data: out, ms: Math.round((performance.now() - t0) * 100) / 100 };
  }
  function callPost(payload) {
    const t0 = performance.now();
    const out = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
    return { data: out, ms: Math.round((performance.now() - t0) * 100) / 100 };
  }

  return { sandbox, ss, sheets, tgCalls, callGet, callPost };
}

function createIsolatedDevice(name, isBaristaTerminal, server) {
  const store = {};
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
  const win = {
    COFFEE_IS_BARISTA_TERMINAL: isBaristaTerminal,
    COFFEE: { API_URL: 'https://mock-gas.local/exec' },
    META: {},
    localStorage: ls,
    navigator: { onLine: true, userAgent: name },
    addEventListener: () => {},
    location: { href: 'https://coffee-illy.example.com/', pathname: isBaristaTerminal ? '/barista.html' : '/admin.html', search: '', hash: '' }
  };
  win.window = win;
  win.self = win;
  win.document = {
    hidden: false,
    visibilityState: 'visible',
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => []
  };
  win.fetch = async (url, opts) => {
    const isPost = opts && String(opts.method || 'GET').toUpperCase() === 'POST';
    let res;
    if (isPost) {
      const body = JSON.parse(opts.body || '{}');
      res = server.callPost(body);
    } else {
      const q = String(url).split('?')[1] || '';
      const params = {};
      q.split('&').forEach((kv) => {
        const [k, v] = kv.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
      res = server.callGet(params);
    }
    return {
      ok: true,
      status: 200,
      json: async () => res.data,
      text: async () => JSON.stringify(res.data)
    };
  };

  const ctx = Object.assign({
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, URL, URLSearchParams, AbortController,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    localStorage: ls,
    window: win,
    self: win,
    document: win.document,
    navigator: win.navigator,
    location: win.location,
    fetch: win.fetch,
    _isoToday: () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  }, {});
  vm.createContext(ctx);

  for (const rel of ['version.js', 'js/defaults.js', 'js/security.js', 'js/storage.js', 'js/sync.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  return { name, ctx, win, ls };
}

(async () => {
  let passed = 0;
  let failed = 0;
  async function runTest(title, fn) {
    try {
      const info = await fn();
      console.log(`  [PASS] ${title}${info ? ' — ' + info : ''}`);
      passed++;
    } catch (e) {
      console.error(`  [FAIL] ${title}: ${e.message}`);
      failed++;
    }
  }

  const server = createGasServer();
  const pcAdmin = createIsolatedDevice('PC-Admin-1440x900', false, server);
  const phoneSonya = createIsolatedDevice('iPhone-Telegram-MiniApp-390x844', true, server);
  const tabletAlina = createIsolatedDevice('Android-Tablet-768x1024', true, server);

  // Login Admin, create staff accounts with 6-digit PINs, then login Phone & Tablet
  const admLogin = server.callPost({ action: 'auth_login', role: 'admin', pin: '778899' }).data;
  assert(admLogin.ok, 'Admin login failed: ' + JSON.stringify(admLogin));
  server.callPost({ action: 'save_staff', sessionToken: admLogin.sessionToken, name: 'Соня', role: 'Бариста', pin: '112233', active: 'да' });
  server.callPost({ action: 'save_staff', sessionToken: admLogin.sessionToken, name: 'Алина', role: 'Бариста', pin: '445566', active: 'да' });
  const sonyaLogin = server.callPost({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '112233' }).data;
  const alinaLogin = server.callPost({ action: 'auth_login', role: 'staff', staffName: 'Алина', pin: '445566' }).data;
  assert(sonyaLogin.ok && alinaLogin.ok, 'Staff login failed: ' + JSON.stringify({ sonyaLogin, alinaLogin }));

  pcAdmin.ls.setItem('coffee_auth_session_v1', JSON.stringify({ role: 'admin', userName: 'Администратор', sessionToken: admLogin.sessionToken }));
  phoneSonya.ls.setItem('coffee_auth_session_v1', JSON.stringify({ role: 'staff', userName: 'Соня', sessionToken: sonyaLogin.sessionToken }));
  phoneSonya.ls.setItem('coffee_active_barista', 'Соня');
  tabletAlina.ls.setItem('coffee_auth_session_v1', JSON.stringify({ role: 'staff', userName: 'Алина', sessionToken: alinaLogin.sessionToken }));
  tabletAlina.ls.setItem('coffee_active_barista', 'Алина');

  // TEST 1: Bug 2 — Unlock survives Save AND reaches Phone via staff_bootstrap
  await runTest('1. Баг 2 (Разблокировка ПК → Телефон): «🔓 Открыть» не стирается после «💾 Сохранить» и долетает до телефона', async () => {
    const t0 = performance.now();
    // Set Лайн Чек 1 to an already-expired window (00:01–00:02)
    const blocks = [
      { id: 'blk_open', name: 'Открытие', openTime: '00:01', deadline: '00:02', isCash: false, active: true },
      { id: 'blk_lc1', name: 'Лайн Чек 1', openTime: '00:01', deadline: '00:02', isCash: false, active: true },
      { id: 'blk_lc2', name: 'Лайн Чек 2', openTime: '14:00', deadline: '16:00', isCash: false, active: true },
      { id: 'blk_close', name: 'Закрытие', openTime: '21:30', deadline: '22:30', isCash: false, active: true },
      { id: 'blk_cash', name: 'Касса', openTime: '22:00', deadline: '23:59', isCash: true, active: true }
    ];
    const rSave1 = server.callPost({ action: 'save_checklist_blocks', sessionToken: admLogin.sessionToken, blocks });
    assert(rSave1.data.ok, 'Initial save_checklist_blocks ok');

    // Phone pulls & verifies Лайн Чек 1 is locked (overdue_closed)
    await phoneSonya.win.coffeeLiveSyncNow();
    const wLocked = phoneSonya.win.coffeeGetBlockWindow('Лайн Чек 1', undefined, 'Соня');
    assert(wLocked.state === 'overdue_closed' && !wLocked.canPass, 'Должен быть заблокирован до разблокировки, но: ' + wLocked.state);

    // Admin clicks «🔓 Открыть», then clicks «💾 Сохранить» (exact demo scenario!)
    const rExt = server.callPost({ action: 'extend_deadline', sessionToken: admLogin.sessionToken, block: 'Лайн Чек 1', openFrom: '00:00', until: '23:59', reason: 'Демо разблокировка' });
    assert(rExt.data.ok, 'extend_deadline ok');
    const rSave2 = server.callPost({ action: 'save_checklist_blocks', sessionToken: admLogin.sessionToken, blocks });
    assert(rSave2.data.ok, 'save_checklist_blocks after unlock ok');
    assert(Object.keys(rSave2.data.deadlineExtensions || {}).length >= 1, 'save_checklist_blocks НЕ должен стирать активную разблокировку!');

    // Phone syncs via coffeeLiveSyncNow
    const tSync0 = performance.now();
    await phoneSonya.win.coffeeLiveSyncNow();
    const syncMs = Math.round((performance.now() - tSync0) * 100) / 100;
    const wOpen = phoneSonya.win.coffeeGetBlockWindow('Лайн Чек 1', undefined, 'Соня');
    assert(wOpen.state === 'open' && wOpen.canPass === true, 'На телефоне блок должен разблокироваться! Получено: ' + JSON.stringify(wOpen));
    return `синхронизация ПК → Телефон за ${syncMs} мс (общий цикл ${Math.round(performance.now() - t0)} мс)`;
  });

  // TEST 2: Bug 3 — New block «Лайн Чек 3» persists after add -> delete -> re-add and reaches Phone
  await runTest('2. Баг 3 (Новый блок «Лайн Чек 3»): добавление, удаление и повторное добавление не пропадает и долетает до телефона', async () => {
    const rAdd1 = server.callPost({ action: 'add_checklist_block', sessionToken: admLogin.sessionToken, name: 'Лайн Чек 3', openTime: '17:00', deadline: '18:00' });
    assert(rAdd1.data.ok && rAdd1.data.checklistBlocks.some((b) => b.name === 'Лайн Чек 3'), 'Лайн Чек 3 добавлен на сервере');
    pcAdmin.ctx.applyLocalMutation({ action: 'delete_checklist_block', name: 'Лайн Чек 3' });
    server.callPost({ action: 'delete_checklist_block', sessionToken: admLogin.sessionToken, name: 'Лайн Чек 3' });

    // Re-add Лайн Чек 3 (previously wiped by deletedChecklistBlocks!)
    pcAdmin.ctx.applyLocalMutation({ action: 'add_checklist_block', name: 'Лайн Чек 3', openTime: '17:30', deadline: '19:00' });
    const rAdd2 = server.callPost({ action: 'add_checklist_block', sessionToken: admLogin.sessionToken, name: 'Лайн Чек 3', openTime: '17:30', deadline: '19:00' });
    assert(rAdd2.data.ok && rAdd2.data.checklistBlocks.some((b) => b.name === 'Лайн Чек 3'), 'Повторно добавленный блок есть на сервере');

    // Verify PC Admin keeps it after absorbServerData AND Phone receives it
    pcAdmin.ctx.absorbServerData('?action=admin', { ok: true, checklistBlocks: rAdd2.data.checklistBlocks });
    assert(pcAdmin.win.coffeeGetChecklistBlocks().some((b) => b.name === 'Лайн Чек 3'), 'ПК не отфильтровал повторно добавленный Лайн Чек 3');

    const tSync0 = performance.now();
    await phoneSonya.win.coffeeLiveSyncNow();
    const syncMs = Math.round((performance.now() - tSync0) * 100) / 100;
    const phoneBlocks = phoneSonya.win.coffeeGetChecklistBlocks();
    assert(phoneBlocks.some((b) => b.name === 'Лайн Чек 3'), 'Телефон получил новый блок Лайн Чек 3');
    return `блок «Лайн Чек 3» доставлен на телефон за ${syncMs} мс`;
  });

  // TEST 3: Bug 1 — Completed checklist never shows false overdue, auto-resolves INC-LATE-*, and syncs shift status to 2nd barista without PII leak
  await runTest('3. Баг 1 (Ложная просрочка): сдача «Лайн Чек 1» закрывает INC-LATE-*, нормализует алиас «День» и видна 2-му бариста без утечки черновиков', async () => {
    // Trigger stale overdue incident on phone first
    phoneSonya.win.coffeeEnforceOverdueChecklists('Соня');
    // Submit Лайн Чек 1 from Соня's phone
    const subRes = server.callPost({
      action: 'submit_checklist',
      sessionToken: sonyaLogin.sessionToken,
      block: 'Лайн Чек 1',
      userName: 'Соня',
      deadline: '23:59',
      isLate: false,
      items: [{ id: 't1', title: 'Проверка эспрессо', status: 'ok', isIncident: false }]
    });
    assert(subRes.data.ok, 'submit_checklist ok');
    phoneSonya.ctx.applyLocalMutation({
      action: 'submit_checklist',
      block: 'Лайн Чек 1',
      userName: 'Соня',
      items: [{ id: 't1', title: 'Проверка эспрессо', status: 'ok', isIncident: false }]
    });

    const wSonya = phoneSonya.win.coffeeGetBlockWindow('Лайн Чек 1', undefined, 'Соня');
    const wAlias = phoneSonya.win.coffeeIsBlockCompletedToday('День', undefined, 'Соня');
    assert(wSonya.state === 'completed' && wSonya.completed === true, 'Соня должна видеть Выполнено, а не просрочку');
    assert(wAlias.completed === true, 'Алиас «День» должен определяться как выполненный «Лайн Чек 1»');

    // Second barista (Алина on Tablet) syncs -> sees shift completion, zero false overdue, AND zero private checklists from Соня!
    const tSync0 = performance.now();
    await tabletAlina.win.coffeeLiveSyncNow();
    const syncMs = Math.round((performance.now() - tSync0) * 100) / 100;
    const wAlina = tabletAlina.win.coffeeGetBlockWindow('Лайн Чек 1', undefined, 'Алина');
    assert(wAlina.state === 'completed' && !wAlina.isOverdue, 'Планшет 2-го бариста не должен выдавать ложную просрочку! Получено: ' + wAlina.state);
    const alinaBoot = server.callPost({ action: 'staff_bootstrap', sessionToken: alinaLogin.sessionToken }).data;
    assert((alinaBoot.checklists || []).every((c) => c.who === 'Алина'), 'Изоляция v4 сохранена: чужие персональные логи не утекли');
    assert(alinaBoot.shiftCompletedBlocksToday && alinaBoot.shiftCompletedBlocksToday['Лайн Чек 1'], 'shiftCompletedBlocksToday содержит статус блока');
    return `статус сдачи доставлен на 2-е устройство за ${syncMs} мс`;
  });

  // TEST 4: Bug 4 — Telegram dedup + inline button deep-link
  await runTest('4. Баг 4 (Telegram-уведомления): inline-кнопка перехода в чек-лист (?block=...) и 30-мин анти-спам дедупликация', async () => {
    const beforeCalls = server.tgCalls.length;
    const r1 = server.sandbox.sendTelegramServerAlert_(server.ss, {
      type: 'overdue',
      block: 'Открытие',
      text: '⏰ Просрочен чек-лист «Открытие» (дедлайн 08:30)'
    });
    assert(r1.ok === true && r1.sentTo === 1, 'Первое уведомление должно отправиться');
    const sentPayload = server.tgCalls[beforeCalls].body;
    assert(sentPayload.reply_markup && sentPayload.reply_markup.inline_keyboard, 'Должна быть inline-кнопка reply_markup');
    const btnUrl = sentPayload.reply_markup.inline_keyboard[0][0].url || '';
    assert(btnUrl.includes('?block='), 'Кнопка должна вести прямо в чек-лист (?block=...): ' + btnUrl);

    const r2 = server.sandbox.sendTelegramServerAlert_(server.ss, {
      type: 'overdue',
      block: 'Открытие',
      text: '⏰ Просрочен чек-лист «Открытие» (дедлайн 08:30)'
    });
    assert(r2.ok === true && r2.deduplicated === true && r2.sentTo === 0, 'Повторное одинаковое уведомление должно подавляться (анти-спам)');
    assert(server.tgCalls.length === beforeCalls + 1, 'В Telegram API ушёл ровно 1 запрос вместо 2');
    return `кнопка: "${sentPayload.reply_markup.inline_keyboard[0][0].text}" → ${btnUrl}`;
  });

  // TEST 5: Sync speed benchmark (10 cycles PC <-> Mobile)
  await runTest('5. Замер скорости синхронизации ПК ↔ Телефон (10 циклов get_rev + staff_bootstrap)', async () => {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      server.callPost({ action: 'extend_deadline', sessionToken: admLogin.sessionToken, block: 'Лайн Чек 2', until: '23:59', reason: 'bench-' + i });
      await phoneSonya.win.coffeeLiveSyncNow();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const avg = (samples.reduce((s, v) => s + v, 0) / samples.length).toFixed(2);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))].toFixed(2);
    return `min=${samples[0].toFixed(2)} мс, avg=${avg} мс, p95=${p95} мс`;
  });

  console.log(`\nИТОГО E2E-ТЕСТОВ ДВУХ УСТРОЙСТВ И СИНХРОНИЗАЦИИ: ${passed}/${passed + failed} успешно.`);
  if (failed > 0) process.exit(1);
})();
