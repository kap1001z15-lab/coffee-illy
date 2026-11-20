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
  globalThis.navigator = {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => { stopped = true; } }]
      }),
      enumerateDevices: async () => [
        { kind: 'videoinput', deviceId: 'cam1', label: 'Front Camera' },
        { kind: 'videoinput', deviceId: 'cam2', label: 'Back Camera' }
      ]
    }
  };
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
        if (sel === '[data-cam="shot"]') return el._shotBtn || (el._shotBtn = makeEl('button'));
        if (sel === '[data-cam="done"]') return el._doneBtn || (el._doneBtn = makeEl('button'));
        if (sel === '[data-cam="close"]') return el._closeBtn || (el._closeBtn = makeEl('button'));
        if (sel === '[data-cam="flip"]') return el._flipBtn || (el._flipBtn = makeEl('button'));
        if (sel === '[data-cam="rec"]') return el._recBtn || (el._recBtn = makeEl('button'));
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
  const shotBtn = overlay.querySelector('[data-cam="shot"]');
  assert.equal(typeof shotBtn.onclick, 'function');
  shotBtn.onclick();
  const out = await p;
  assert.equal(capturedUri, 'data:image/jpeg;base64,TEST_PHOTO_DATA');
  assert.equal(capturedMeta.mediaType, 'image');
  assert.ok(out && out.dataUrl === 'data:image/jpeg;base64,TEST_PHOTO_DATA');
});
