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
