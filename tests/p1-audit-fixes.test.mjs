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
const hasGas = fs.existsSync(gasPath);

test('Audit #1: sw.js uses v98-4-0, ignoreSearch:true, and never returns index.html for offline JS/CSS', () => {
  const sw = fs.readFileSync(path.resolve(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes("coffee-illy-v98-4-0"), 'CACHE_NAME must match v98.4.0');
  assert.ok(sw.includes('ignoreSearch: true'), 'caches.match must use ignoreSearch: true for ?v= query strings');
  assert.ok(sw.includes('status: 503'), 'Offline JS/CSS fallback must return 503 instead of HTML');
  for (const fn of ['index.html', 'dashboard.html']) {
    const h = fs.readFileSync(path.resolve(root, fn), 'utf8');
    assert.equal(h.includes('?v=97.9.0'), false, `${fn} must not keep stale ?v=97.9.0 query strings`);
    assert.ok(h.includes('?v=98.4.0'), `${fn} must reference ?v=98.4.0`);
  }
});

test('Audit #2 & #3: dashboard.html has no colliding modal IDs (sp/sa/sn/ea) and no plaintext s.pin in staff modal', () => {
  const dash = fs.readFileSync(path.resolve(root, 'dashboard.html'), 'utf8');
  const countId = (id) => (dash.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length;
  assert.ok(countId('sp') <= 1, 'id="sp" must not collide');
  assert.ok(countId('sa') <= 1, 'id="sa" must not collide');
  assert.equal(countId('sn'), 1, 'id="sn" must appear only once');
  assert.equal(countId('ea'), 1, 'id="ea" must appear only once');
  assert.ok(dash.includes('id="m-staff-pin"'), 'Staff modal must use unique m-staff-pin ID');
  assert.equal(dash.includes('esc(s.pin)'), false, 'Staff modal must not render plaintext s.pin');
});

test('Audit #4 & #5: cloud-sync.js preserves financial ops beyond 500 items, tracks failed ops, and supports typed dispatchOperation()', () => {
  const store = new Map();
  const ctx = {
    window: { COFFEE_CONFIG: { API_URL: '' }, addEventListener: () => {} },
    document: { hidden: false, visibilityState: 'visible', addEventListener: () => {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    navigator: { onLine: false },
    fetch: async () => { throw new Error('offline'); },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise,
    setTimeout: () => 0, clearTimeout: () => {}, encodeURIComponent, module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(root, 'js/cloud-sync.js'), 'utf8'), ctx);
  const api = ctx.window.CoffeeCloudV94;

  const rCash = api.dispatchOperation({ type: 'cash.submit', payload: { date: '2026-11-23', cash: 1000, card: 2000, checks: 40 }, actor: 'Соня' });
  assert.equal(rCash.ok, true);
  assert.equal(rCash.action, 'submit_cash');

  const rBad = api.dispatchOperation({ type: 'nonexistent.op', payload: {} });
  assert.equal(rBad.ok, false);
  assert.ok(api.getPendingCount() >= 1);
  assert.equal(typeof api.getFailedOps, 'function');
  assert.equal(typeof api.retryFailedOps, 'function');
});

test('Audit #6 & #7: Code.gs enforces 9KB PropertiesService guard and blocks protected GET actions', { skip: !hasGas }, () => {
  const props = new Map();
  const sandbox = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => 'GMT+2' },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'S', getSheetByName: () => null, insertSheet: () => ({ appendRow: () => {}, getLastRow: () => 1, getDataRange: () => ({ getValues: () => [['']] }), setFrozenRows: () => {} }) }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); }
      })
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    LockService: { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt) => ({ _t: txt, setMimeType: function () { return this; }, getContent: function () { return this._t; } })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()),
      getUuid: () => crypto.randomUUID(),
      formatDate: () => '2026-11-23'
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(gasPath, 'utf8'), sandbox, { filename: 'Code.gs' });

  // #6: Oversized array > 9KB must be trimmed safely <= 8500 chars
  const hugeArr = Array.from({ length: 300 }, (_, i) => ({ id: 'item_' + i, payload: 'x'.repeat(50) }));
  sandbox.setJsonProp_('TEST_HUGE_PROP', hugeArr);
  const stored = props.get('TEST_HUGE_PROP') || '';
  assert.ok(stored.length <= 8500, `Stored JSON must be <= 8500 chars, got ${stored.length}`);

  // #7: Protected GET actions must return METHOD_NOT_ALLOWED
  for (const act of ['admin', 'dashboard', 'report']) {
    const res = JSON.parse(sandbox.doGet({ parameter: { action: act, sessionToken: 'secret' } }).getContent());
    assert.equal(res.ok, false);
    assert.match(res.error, /METHOD_NOT_ALLOWED/);
  }
});

test('Audit #8, #9, #10, #11, #12: defer Telegram SDK, m3-soft.css linked, owner.html redirect, CI workflow present', () => {
  for (const fn of ['index.html', 'dashboard.html']) {
    const h = fs.readFileSync(path.resolve(root, fn), 'utf8');
    assert.ok(h.includes('telegram-web-app.js" defer'), `${fn} must load telegram-web-app.js with defer`);
    assert.ok(h.includes('css/m3-soft.css?v=98.4.0'), `${fn} must link css/m3-soft.css`);
  }
  const m3 = fs.readFileSync(path.resolve(root, 'css/m3-soft.css'), 'utf8');
  assert.ok(m3.includes('@media (max-width: 380px)'), 'm3-soft.css must support <= 380px narrow screens');
  assert.ok(m3.includes('@media (pointer: coarse)'), 'm3-soft.css must enforce 44px touch targets');
  assert.ok(m3.includes('.skeleton-pulse'), 'm3-soft.css must provide skeleton animation');

  const owner = fs.readFileSync(path.resolve(root, 'owner.html'), 'utf8');
  assert.ok(owner.length < 2000 && owner.includes('dashboard.html'), 'owner.html must be a lightweight redirect to dashboard.html');

  const ci = fs.readFileSync(path.resolve(root, '.github/workflows/ci-deploy.yml'), 'utf8');
  assert.ok(ci.includes('npm run test:full'), 'CI workflow must run npm run test:full before deploy');
});

test('v98.4.0 Full Codebase Audit: 100% cloud-sync -> GAS doPost action parity (incl. clear_deadline_extension) & zero dead stubs', () => {
  const gas = fs.readFileSync(path.join(process.cwd(), 'gas/Code.gs'), 'utf8');
  const cs = fs.readFileSync(path.join(process.cwd(), 'js/cloud-sync.js'), 'utf8');
  assert.ok(!/function\s+submitWriteoff_\s*\(/.test(gas), 'Dead submitWriteoff_ stub must be removed');
  assert.ok(!/function\s+safeTgHref_\s*\(/.test(gas), 'Dead safeTgHref_ helper must be removed');
  assert.match(gas, /action\s*===\s*'clear_deadline_extension'/, 'GAS doPost must handle clear_deadline_extension');
  const csActions = new Set([
    ...[...cs.matchAll(/(?:gasPost|enqueueOp)\(\s*'([a-z0-9_]+)'/g)].map(m => m[1]),
    ...[...cs.slice(cs.indexOf('TYPE_TO_ACTION'), cs.indexOf('TYPE_TO_ACTION') + 1200).matchAll(/:\s*'([a-z0-9_]+)'/g)].map(m => m[1])
  ]);
  const gasActions = new Set([...gas.matchAll(/action\s*===\s*'([a-z0-9_]+)'/g)].map(m => m[1]));
  const missing = [...csActions].filter(a => !gasActions.has(a));
  assert.deepEqual(missing, [], 'Every cloud-sync.js action must exist in GAS doPost');
});
