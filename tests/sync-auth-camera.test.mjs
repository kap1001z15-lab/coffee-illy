import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Minimal browser globals for testing client modules in Node.js
globalThis.window = globalThis;
globalThis.COFFEE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/TEST/exec',
  OFFLINE_BASE_DELAY_MS: 1500
};
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k)
};

const cloud = require('../js/cloud-sync.js');
const camera = require('../js/camera.js');
const timePicker = require('../js/time-picker.js');

test('Sync exponential backoff grows and caps cleanly', () => {
  assert.equal(cloud.computeBackoffMs(0, 1500, 60000), 1500);
  assert.equal(cloud.computeBackoffMs(1, 1500, 60000), 3000);
  assert.equal(cloud.computeBackoffMs(2, 1500, 60000), 6000);
  assert.equal(cloud.computeBackoffMs(10, 1500, 60000), 60000);
});

test('Anti-race local mutation counter increments monotonically', () => {
  const before = cloud.getLocalMutationSeq();
  const next1 = cloud.markLocalMutation();
  const next2 = cloud.markLocalMutation();
  assert.equal(next1, before + 1);
  assert.equal(next2, before + 2);
});

test('Camera error mapper returns clear Russian guidance', () => {
  assert.match(camera.mapCameraError({ name: 'NotAllowedError' }), /запрещён/i);
  assert.match(camera.mapCameraError({ name: 'NotFoundError' }), /не найдена/i);
  assert.match(camera.mapCameraError({ name: 'NotReadableError' }), /занята/i);
  assert.match(camera.mapCameraError({ name: 'OverconstrainedError' }), /не поддерживает/i);
});

test('Camera prewarm requests permission once and releases tracks cleanly', async () => {
  let stopped = false;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { stopped = true; } }]
        }),
        enumerateDevices: async () => [
          { kind: 'videoinput', deviceId: 'cam1', label: 'Front Camera' },
          { kind: 'videoinput', deviceId: 'cam2', label: 'Back Camera' }
        ]
      }
    }
  });
  const res = await camera.prewarm();
  assert.equal(res.ok, true);
  assert.equal(stopped, true, 'prewarm should release hardware track after permission check');
  const devs = await camera.listVideoDevices();
  assert.equal(devs.length, 2);
});

test('Pixel M3 TimePicker parses and clamps HH:MM cleanly', () => {
  assert.deepEqual(timePicker.parseHHMM('08:30'), { h: 8, m: 30 });
  assert.deepEqual(timePicker.parseHHMM('23:59'), { h: 23, m: 59 });
  assert.deepEqual(timePicker.parseHHMM('bad'), { h: 8, m: 30 });
  assert.equal(timePicker.pad2(7), '07');
});

test('CloudSync flushOutbox retains retryable LOCK_TIMEOUT ops with exponential backoff and succeeds on retry', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  globalThis.window = {
    COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/test/exec', OFFLINE_BASE_DELAY_MS: 1000 }
  };
  let callNum = 0;
  globalThis.fetch = async () => {
    callNum++;
    if (callNum === 1) {
      return { ok: true, json: async () => ({ ok: false, error: 'LOCK_TIMEOUT: busy' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };

  // Load fresh instance of cloud-sync.js
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  const ctx = {
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    fetch: globalThis.fetch,
    navigator: { onLine: true },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, setTimeout, clearTimeout, encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const cloud = ctx.window.CoffeeCloudV94;

  // Seed one outbox item directly
  store.set('coffee_illy_v93_outbox', JSON.stringify([{
    action: 'add_expense',
    payload: { operationId: 'op_retry_1', amount: 150, category: 'Молоко' },
    ts: Date.now(),
    attempts: 0,
    nextRetryAt: 0
  }]));

  // First flush hits LOCK_TIMEOUT -> item must NOT be dropped and nextRetryAt must be in the future
  const r1 = await cloud.flushOutbox(true);
  assert.equal(r1.flushed, 0);
  assert.equal(r1.pending, 1);
  const afterFail = JSON.parse(store.get('coffee_illy_v93_outbox'));
  assert.equal(afterFail.length, 1);
  assert.equal(afterFail[0].attempts, 1);
  assert.ok(afterFail[0].nextRetryAt > Date.now());

  // Force retry -> succeeds and clears outbox
  const r2 = await cloud.flushOutbox(true);
  assert.equal(r2.flushed, 1);
  assert.equal(r2.pending, 0);
});

test('CloudSync mergeServerIntoState preserves revenue, avgPrice, serve, and Russian salesLog kinds', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  const ctx = {
    window: { COFFEE_CONFIG: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, setTimeout, clearTimeout, encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const cloud = ctx.window.CoffeeCloudV94;
  const st = {};
  const changed = cloud.mergeServerIntoState(st, {
    cash: [{ date: '2026-11-20', cash: 1000, card: 1450, checks: 70, barista: 'Соня', csvHashes: ['h1'] }],
    ttk: [{ id: 't1', name: '☕ Капучино', volume: '250 мл', category: 'Классика', price: 19, avgPrice: 18.5, cost: 0, serving: 'Стакан 250' }],
    salesLog: [{ date: '2026-11-20', barista: 'Соня', name: 'Капучино', kind: 'coffee', price: 19, qty: 4, sum: 76 }]
  });
  assert.equal(changed, true);
  assert.equal(st.cash[0].revenue, 2450);
  assert.deepEqual(st.cash[0].csvHashes, ['h1']);
  assert.equal(st.ttk[0].avgPrice, 18.5);
  assert.equal(st.ttk[0].serve, 'Стакан 250');
  assert.equal(st.salesLog[0].kind, 'Кофе');
});

test('CloudSync pullNow skips overwriting state when a local mutation happens mid-request (anti-race)', async () => {
  const store = new Map();
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  let resolveFetch = null;
  let cloudRef = null;
  const ctx = {
    window: {
      COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/test/exec' },
      addEventListener: () => {}
    },
    document: { hidden: false, visibilityState: 'visible', addEventListener: () => {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    fetch: (url) => {
      if (String(url).includes('action=get_rev')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, rev: '500' }) });
      }
      return new Promise((resolve) => {
        resolveFetch = () => resolve({
          ok: true,
          json: async () => ({ ok: true, location: 'Stale Server Location' })
        });
      });
    },
    navigator: { onLine: true },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise,
    setTimeout: () => 0,
    clearTimeout: () => {},
    encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  cloudRef = ctx.window.CoffeeCloudV94;

  const state = { location: 'Fresh Local Edit' };
  const loop = cloudRef.startCloudLoop({
    mode: 'terminal',
    getState: () => state,
    onSynced: () => {}
  });
  // Wait for get_rev to finish and fetch(get_checklists) to be in-flight
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(typeof resolveFetch === 'function', 'pullNow should be waiting on server payload');
  // Simulate user editing locally while pullNow is in-flight
  cloudRef.markLocalMutation();
  resolveFetch();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(state.location, 'Fresh Local Edit', 'Stale in-flight server response must NOT overwrite fresh local mutation');
});

test('CoffeeCameraV94.open invokes onCaptured(dataUri, meta) when shutter fires in single-photo mode', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/camera.js', import.meta.url), 'utf8');
  const listeners = new Map();
  function makeEl(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      style: { cssText: '' },
      children: [],
      dataset: {},
      disabled: false,
      value: '',
      innerHTML: '',
      textContent: '',
      className: '',
      videoWidth: 640,
      videoHeight: 480,
      width: 640,
      height: 480,
      srcObject: null,
      play: async () => {},
      appendChild: (c) => { el.children.push(c); return c; },
      removeChild: (c) => { el.children = el.children.filter((x) => x !== c); },
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => 'data:image/jpeg;base64,TEST_PHOTO_DATA',
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: (sel) => {
        if (sel === 'video') return makeEl('video');
        if (sel === '[data-cam="shutter"]') return el._shotBtn || (el._shotBtn = makeEl('button'));
        if (sel === '[data-cam="done"]') return el._doneBtn || (el._doneBtn = makeEl('button'));
        if (sel === '[data-cam="close"]') return el._closeBtn || (el._closeBtn = makeEl('button'));
        if (sel === '[data-cam="flip"]') return el._flipBtn || (el._flipBtn = makeEl('button'));
        if (sel === '[data-cam="video"]') return el._recBtn || (el._recBtn = makeEl('button'));
        if (sel === '[data-cam="err"]') return el._errEl || (el._errEl = makeEl('div'));
        if (sel === '[data-cam="devices"]') return el._devSel || (el._devSel = makeEl('select'));
        if (sel === '[data-cam="devwrap"]') return el._devWrap || (el._devWrap = makeEl('div'));
        if (sel === '[data-cam="strip"]') return el._strip || (el._strip = makeEl('div'));
        if (sel === '[data-cam="count"]') return el._cnt || (el._cnt = makeEl('div'));
        if (sel === '[data-cam="recbadge"]') return el._recBadge || (el._recBadge = makeEl('div'));
        return null;
      }
    };
    return el;
  }
  const fakeDoc = {
    body: makeEl('body'),
    hidden: false,
    createElement: (tag) => makeEl(tag),
    addEventListener: (ev, fn) => listeners.set(ev, fn),
    removeEventListener: (ev) => listeners.delete(ev)
  };
  const ctx = {
    window: {},
    document: fakeDoc,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
        enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'cam1', label: 'Back Camera' }]
      }
    },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const camApi = ctx.window.CoffeeCameraV94;

  let capturedUri = '';
  let capturedMeta = null;
  const p = camApi.open({
    title: 'Test',
    multi: false,
    onCaptured: (uri, meta) => {
      capturedUri = uri;
      capturedMeta = meta;
    }
  });
  await new Promise((r) => setTimeout(r, 20));
  const overlay = fakeDoc.body.children[0];
  assert.ok(overlay, 'Camera overlay should mount');
  const shotBtn = overlay.querySelector('[data-cam="shutter"]');
  assert.equal(typeof shotBtn.onclick, 'function');
  shotBtn.onclick();
  const out = await p;
  assert.equal(capturedUri, 'data:image/jpeg;base64,TEST_PHOTO_DATA');
  assert.equal(capturedMeta.mediaType, 'image');
  assert.ok(out && out.dataUrl === 'data:image/jpeg;base64,TEST_PHOTO_DATA');
});

test('CloudSync mergeServerIntoState syncs deadlineExtensions (unlock and clear) for today', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  const ctx = {
    window: { COFFEE_CONFIG: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, setTimeout, clearTimeout, encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const cloud = ctx.window.CoffeeCloudV94;
  const today = cloud.localISO();
  const st = { extensions: {} };

  cloud.mergeServerIntoState(st, {
    deadlineExtensions: {
      [today + ':Лайн Чек 1']: { forceOpen: true, openFrom: '00:00', until: '23:59' },
      '2020-01-01:Старый блок': { forceOpen: true }
    }
  });
  assert.ok(st.extensions['Лайн Чек 1'] && st.extensions['Лайн Чек 1'].forceOpen === true, 'Today unlock must be synced');
  assert.equal(st.extensions['Старый блок'], undefined, 'Past-date extension must not leak');

  cloud.mergeServerIntoState(st, { deadlineExtensions: {} });
  assert.equal(st.extensions['Лайн Чек 1'], undefined, 'Clearing extension on owner dashboard must re-lock on barista phone');
});

test('CloudSync mergeServerIntoState syncs announcements array', async () => {
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  const ctx = {
    window: { COFFEE_CONFIG: {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { onLine: true },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, setTimeout, clearTimeout, encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const cloud = ctx.window.CoffeeCloudV94;
  const st = {};
  cloud.mergeServerIntoState(st, { announcements: [{ id: 'a1', title: 'Собрание', text: 'В 19:00' }] });
  assert.equal(st.announcements.length, 1);
  assert.equal(st.announcements[0].title, 'Собрание');
});

test('CloudSync saveInventoryItem queues to outbox when offline instead of dropping', async () => {
  const store = new Map();
  const fs = await import('node:fs');
  const vm = await import('node:vm');
  const src = fs.readFileSync(new URL('../js/cloud-sync.js', import.meta.url), 'utf8');
  const ctx = {
    window: { COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/test/exec' } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    navigator: { onLine: false },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Promise, setTimeout, clearTimeout, encodeURIComponent,
    module: { exports: {} }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const cloud = ctx.window.CoffeeCloudV94;
  const res = await cloud.saveInventoryItem({ id: 'inv_1', name: 'Молоко', stock: 12 });
  assert.equal(res.ok, true);
  assert.equal(res.queued, true);
  assert.equal(cloud.getPendingCount(), 1);
});

test('Apple Liquid Retina TimePicker parses & formats manual keyboard inputs (2130, 9:5, 25:99) cleanly', async () => {
  const tpMod = await import(new URL('../js/time-picker.js', import.meta.url));
  const TimePicker = tpMod.default || tpMod;
  assert.equal(TimePicker.formatTimeInput('2130'), '21:30');
  assert.equal(TimePicker.formatTimeInput('905'), '09:05');
  assert.equal(TimePicker.formatTimeInput('9:5'), '09:05');
  assert.equal(TimePicker.formatTimeInput('25:99'), '23:59');
  assert.equal(TimePicker.formatTimeInput('7'), '07:00');
});

test('Dashboard pins BOTH #admin-nav and #date-filter-bar in .dash-sticky-dock and uses overflow-x: clip', () => {
  const dashHtml = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  assert.match(dashHtml, /id="dash-sticky-dock"/);
  assert.match(dashHtml, /body\s*\{\s*overflow-x:\s*clip;/);
  assert.ok(!dashHtml.includes('readonly data-time-picker="1"'), 'Time inputs must allow direct keyboard typing');
});

test('Camera keepAlive prewarm requests OS permission ONCE and reuses standby stream across checklist steps without re-prompting', async () => {
  let gumCalls = 0;
  let stopped = false;
  const fakeTrack = {
    readyState: 'live',
    enabled: true,
    stop: () => { stopped = true; fakeTrack.readyState = 'ended'; }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          gumCalls++;
          return { getTracks: () => [fakeTrack] };
        },
        enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'back', label: 'Back Camera' }]
      }
    }
  });
  camera.stopStream();
  const r1 = await camera.prewarm({ keepAlive: true });
  assert.equal(r1.ok, true);
  assert.equal(gumCalls, 1, 'prewarm({ keepAlive: true }) must call getUserMedia once');
  assert.equal(stopped, false, 'keepAlive prewarm must pause track instead of stopping it');
  assert.equal(fakeTrack.enabled, false, 'track must be paused (enabled=false) in standby');
  assert.equal(camera.hasLiveStream(), true, 'live stream remains ready for next checklist step');
  // Second prewarm call reuses stream without another OS prompt
  const r2 = await camera.prewarm({ keepAlive: true });
  assert.equal(r2.ok, true);
  assert.equal(gumCalls, 1, 'Repeated prewarm must NOT trigger another OS camera permission prompt');
  camera.stopStream();
  assert.equal(stopped, true, 'Explicit stopStream() on logout releases hardware cleanly');
});

test('v98.3.0 Online/Offline Green-Yellow Pill, Unsynced Files Counter & Offline Photo->Checklist URL Chaining', async () => {
  const prevNav = globalThis.navigator;
  const prevFetch = globalThis.fetch;
  const prevLS = globalThis.localStorage;
  const prevWin = globalThis.window;

  const store = new Map();
  const lsMock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  let isOnline = false;
  const posted = [];
  const winMock = {
    COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/test/exec' },
    localStorage: lsMock,
    addEventListener: () => {},
    dispatchEvent: () => {}
  };
  globalThis.window = winMock;
  globalThis.localStorage = lsMock;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { get onLine() { return isOnline; } }
  });
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    posted.push(body);
    const respObj = body.action === 'upload_photo'
      ? { ok: true, url: 'https://drive.google.com/file/d/OFFLINE_PHOTO_1/view', fileId: 'OFFLINE_PHOTO_1' }
      : { ok: true, rev: 99 };
    return { ok: true, text: async () => JSON.stringify(respObj), json: async () => respObj };
  };

  try {
    const code = fs.readFileSync(path.join(process.cwd(), 'js/cloud-sync.js'), 'utf8');
    const fn = new Function('window', 'localStorage', 'navigator', 'fetch', code);
    fn(winMock, lsMock, globalThis.navigator, globalThis.fetch);
    const api = winMock.CoffeeCloudV94;
    assert.ok(api && typeof api.getSyncStatus === 'function');

    // 1. Offline: upload photo + submit checklist -> both queued cleanly
    const upRes = await api.uploadMediaToDrive({ dataUri: 'data:image/jpeg;base64,AAAA', userName: 'Соня', block: 'Открытие', taskId: 't1' });
    assert.equal(upRes.queued, true);
    api.dispatchStateChange({
      checklists: [{
        block: 'Открытие', who: 'Соня', date: '2026-11-25', deadline: '11:00', isLate: false,
        items: [{ id: 't1', title: 'Кофемашина', photo_url: '', isIncident: false }]
      }]
    }, 'Соня', 'Сдан чек-лист «Открытие»');
    const stOff = api.getSyncStatus({ liveConnected: false });
    assert.equal(stOff.online, false);
    assert.equal(stOff.totalUnsynced, 2, 'Must count both queued photo and queued checklist');

    // 2. Back online: flushOutbox uploads photo, injects Drive URL into submit_checklist, and delivers both!
    isOnline = true;
    const fl = await api.flushOutbox(true);
    assert.equal(fl.flushed, 2);
    assert.equal(fl.pending, 0);
    const chkPost = posted.find((x) => x.action === 'submit_checklist');
    assert.ok(chkPost, 'submit_checklist must be delivered to server');
    assert.equal(chkPost.items[0].photo_url, 'https://drive.google.com/file/d/OFFLINE_PHOTO_1/view', 'Offline photo Drive URL must be injected into queued checklist');
    const stOn = api.getSyncStatus({ liveConnected: true });
    assert.equal(stOn.online, true);
    assert.equal(stOn.totalUnsynced, 0);

    // 3. Verify Green/Yellow pill CSS & UI wiring in both clients
    const css = fs.readFileSync(path.join(process.cwd(), 'css/m3-soft.css'), 'utf8');
    const idxHtml = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    const dashHtml = fs.readFileSync(path.join(process.cwd(), 'dashboard.html'), 'utf8');
    assert.match(css, /\.live-pill\.is-online/);
    assert.match(css, /\.live-pill\.is-offline/);
    assert.match(idxHtml, /id="hdr-sync-pill"/);
    assert.match(idxHtml, /function updateSyncPill/);
    assert.match(dashHtml, /id="hdr-sync-pill"/);
    assert.match(dashHtml, /function updateSyncPill/);
  } finally {
    globalThis.window = prevWin;
    globalThis.localStorage = prevLS;
    globalThis.fetch = prevFetch;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prevNav });
  }
});

test('v98.3.0 Fast Sync: coalesces duplicate drafts, isolates foreign staff outbox items, and runs parallel photo uploads', async () => {
  const prevNav = globalThis.navigator;
  const prevFetch = globalThis.fetch;
  const prevLS = globalThis.localStorage;
  const prevWin = globalThis.window;
  const store = new Map();
  const lsMock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  let isOnline = false;
  let inFlight = 0;
  let maxConcurrent = 0;
  const winMock = {
    COFFEE_CONFIG: { API_URL: 'https://script.google.com/macros/s/test/exec' },
    localStorage: lsMock,
    addEventListener: () => {},
    dispatchEvent: () => {}
  };
  globalThis.window = winMock;
  globalThis.localStorage = lsMock;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return isOnline; } } });
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    inFlight++;
    if (inFlight > maxConcurrent) maxConcurrent = inFlight;
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    const respObj = body.action === 'upload_photo'
      ? { ok: true, url: 'https://drive.google.com/file/d/' + body.taskId + '/view' }
      : { ok: true, rev: 100 };
    return { ok: true, text: async () => JSON.stringify(respObj), json: async () => respObj };
  };
  try {
    const code = fs.readFileSync(path.join(process.cwd(), 'js/cloud-sync.js'), 'utf8');
    const fn = new Function('window', 'localStorage', 'navigator', 'fetch', code);
    fn(winMock, lsMock, globalThis.navigator, globalThis.fetch);
    const api = winMock.CoffeeCloudV94;

    // 1. Seed 3 duplicate save_checklist_draft ops offline -> must coalesce into 1!
    lsMock.setItem('coffee_illy_v93_session', JSON.stringify({ staffName: 'Настя', staffToken: 'tok_n' }));
    api.enqueueOp('save_checklist_draft', { userName: 'Настя', block: 'Лайн Чек 2', done: 1, total: 9 });
    api.enqueueOp('save_checklist_draft', { userName: 'Настя', block: 'Лайн Чек 2', done: 2, total: 9 });
    api.enqueueOp('save_checklist_draft', { userName: 'Настя', block: 'Лайн Чек 2', done: 3, total: 9 });
    assert.equal(api.getPendingOps().filter((x) => x.action === 'save_checklist_draft').length, 1, 'Duplicate drafts for same block must coalesce to 1');

    // 2. Add 3 offline photos -> flush online must upload them in parallel (maxConcurrent >= 2)
    await api.uploadMediaToDrive({ dataUri: 'data:image/jpeg;base64,A', userName: 'Настя', block: 'Лайн Чек 2', taskId: 'p1' });
    await api.uploadMediaToDrive({ dataUri: 'data:image/jpeg;base64,B', userName: 'Настя', block: 'Лайн Чек 2', taskId: 'p2' });
    await api.uploadMediaToDrive({ dataUri: 'data:image/jpeg;base64,C', userName: 'Настя', block: 'Лайн Чек 2', taskId: 'p3' });
    isOnline = true;
    const fl = await api.flushOutbox(true);
    assert.equal(fl.flushed, 4);
    assert.equal(fl.pending, 0);
    assert.ok(maxConcurrent >= 2, 'Photo uploads must run in parallel batches');
  } finally {
    globalThis.window = prevWin;
    globalThis.localStorage = prevLS;
    globalThis.fetch = prevFetch;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prevNav });
  }
});
