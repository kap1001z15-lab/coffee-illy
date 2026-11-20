/**
 * Coffee Illy — Cross-Platform Camera Module (v97.0.0)
 * Единый модуль (заменяет дубликаты camera-v92.js и camera-v94.js).
 *
 * Возможности:
 * - Однократный запрос разрешения и prewarm() при открытии чек-листа
 * - Фото (сжатие до 1280px JPEG 0.78) + Видео до 15 сек (MediaRecorder)
 * - Мультисъёмка: несколько фото/видео на один шаг; ЗАГРУЗКА ИЗ ГАЛЕРЕИ ЗАПРЕЩЕНА
 * - Переключение фронтальная/тыловая камера (Android/iOS) + выбор устройства (Windows/macOS с несколькими камерами)
 * - Освобождение ресурсов при сворачивании (visibilitychange) и переинициализация при возврате
 * - Понятные сообщения об ошибках (отказ, нет камеры, занята другим приложением, HTTP вместо HTTPS)
 */
(function (global) {
  'use strict';

  var MAX_VIDEO_SEC = 15;
  var MAX_PHOTO_DIM = 1280;
  var JPEG_QUALITY = 0.78;

  var state = {
    stream: null,
    facingMode: 'environment',
    selectedDeviceId: '',
    devices: [],
    prewarmed: false,
    recording: false,
    mediaRecorder: null,
    recChunks: [],
    recTimer: null,
    recSec: 0,
    overlay: null,
    onDone: null,
    capturedItems: [],
    multiMode: true,
    allowVideo: true
  };

  function mapCameraError(err) {
    if (!err) return 'Не удалось открыть камеру.';
    var name = String(err.name || '');
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return 'Доступ к камере запрещён. Разрешите камеру в настройках браузера или Telegram и повторите попытку.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'Камера не найдена на этом устройстве. Подключите веб-камеру или используйте телефон.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Камера занята другим приложением. Закройте другие программы с камерой и попробуйте снова.';
    }
    if (name === 'OverconstrainedError') {
      return 'Выбранная камера не поддерживает запрошенные параметры. Пробуем базовый режим.';
    }
    if (name === 'SecurityError' || (typeof location !== 'undefined' && location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) {
      return 'Камера работает только по защищённому соединению HTTPS.';
    }
    return 'Ошибка камеры: ' + String(err.message || name || err);
  }

  function pickSupportedVideoMime() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    var candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm'
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (_) {}
    }
    return '';
  }

  function stopStream() {
    if (state.recTimer) {
      clearInterval(state.recTimer);
      state.recTimer = null;
    }
    if (state.mediaRecorder && state.recording) {
      try { state.mediaRecorder.stop(); } catch (_) {}
    }
    state.recording = false;
    if (state.stream) {
      try {
        state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
      } catch (_) {}
      state.stream = null;
    }
  }

  async function listVideoDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      var all = await navigator.mediaDevices.enumerateDevices();
      state.devices = all.filter(function (d) { return d && d.kind === 'videoinput'; });
      return state.devices;
    } catch (_) {
      return [];
    }
  }

  async function acquireStream(withAudio) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Браузер не поддерживает доступ к камере (MediaDevices API).');
    }
    stopStream();

    var videoConstraints = state.selectedDeviceId
      ? { deviceId: { exact: state.selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
      : { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } };

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: !!withAudio });
    } catch (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') && (state.selectedDeviceId || state.facingMode)) {
        state.selectedDeviceId = '';
        state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else {
        throw err;
      }
    }
    await listVideoDevices();
    return state.stream;
  }

  async function prewarm() {
    if (state.prewarmed) return { ok: true, prewarmed: true };
    try {
      var s = await acquireStream(false);
      state.prewarmed = true;
      // Сразу освобождаем аппаратный сенсор после получения разрешения, чтобы экономить батарею
      stopStream();
      return { ok: true, prewarmed: true, tracks: s ? s.getTracks().length : 0 };
    } catch (err) {
      return { ok: false, error: mapCameraError(err) };
    }
  }

  function capturePhotoFromVideo(videoEl) {
    var vw = videoEl.videoWidth || 1280;
    var vh = videoEl.videoHeight || 720;
    var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(vw, vh));
    var w = Math.max(1, Math.round(vw * scale));
    var h = Math.max(1, Math.round(vh * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    var dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    return {
      kind: 'photo',
      mimeType: 'image/jpeg',
      dataUrl: dataUrl,
      width: w,
      height: h,
      createdAt: new Date().toISOString()
    };
  }

  function open(opts) {
    opts = opts || {};
    state.multiMode = opts.multi !== false;
    state.allowVideo = opts.allowVideo !== false;
    state.capturedItems = [];
    state.onDone = typeof opts.onCapture === 'function' ? opts.onCapture : null;

    return new Promise(function (resolve, reject) {
      var resolved = false;
      function finish(items, cancelled) {
        if (resolved) return;
        resolved = true;
        cleanupUi();
        if (cancelled) {
          resolve(null);
          return;
        }
        var out = state.multiMode ? items : (items[0] || null);
        if (state.onDone && out) {
          try { state.onDone(out); } catch (_) {}
        }
        resolve(out);
      }

      function cleanupUi() {
        document.removeEventListener('visibilitychange', onVisibility);
        stopStream();
        if (state.overlay && state.overlay.parentNode) {
          state.overlay.parentNode.removeChild(state.overlay);
        }
        state.overlay = null;
      }

      async function onVisibility() {
        if (!state.overlay) return;
        if (document.hidden) {
          stopStream();
        } else {
          try {
            var v = state.overlay.querySelector('video');
            if (v) {
              var s = await acquireStream(false);
              v.srcObject = s;
              await v.play();
            }
          } catch (_) {}
        }
      }
      document.addEventListener('visibilitychange', onVisibility);

      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:#0d0c0c;color:#fff;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
      ov.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;gap:8px;">' +
          '<button type="button" data-cam="close" style="background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:999px;padding:8px 14px;font-weight:700;cursor:pointer;">✕ Закрыть</button>' +
          '<div style="font-size:13px;font-weight:700;text-align:center;flex:1;">' + (opts.title || 'Живая камера (без галереи)') + '</div>' +
          '<button type="button" data-cam="flip" style="background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:999px;padding:8px 12px;font-weight:700;cursor:pointer;">🔄</button>' +
        '</div>' +
        '<div data-cam="devwrap" style="padding:0 14px 8px;display:none;">' +
          '<select data-cam="devices" style="width:100%;padding:8px 10px;border-radius:10px;background:#23201e;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:13px;"></select>' +
        '</div>' +
        '<div style="position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;">' +
          '<video autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>' +
          '<div data-cam="err" style="display:none;position:absolute;inset:16px;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,0.82);border-radius:16px;padding:20px;font-size:14px;line-height:1.5;"></div>' +
          '<div data-cam="recbadge" style="display:none;position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#C62828;color:#fff;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:800;">● REC 00:00 / 00:15</div>' +
        '</div>' +
        '<div data-cam="strip" style="display:none;gap:8px;overflow-x:auto;padding:8px 14px;background:#171514;"></div>' +
        '<div style="display:flex;align-items:center;justify-content:space-around;padding:14px 16px 18px;background:#171514;gap:10px;">' +
          (state.allowVideo ? '<button type="button" data-cam="video" style="background:rgba(255,255,255,0.14);color:#fff;border:none;border-radius:999px;padding:12px 16px;font-weight:700;cursor:pointer;">🎥 Видео (15с)</button>' : '<span></span>') +
          '<button type="button" data-cam="shutter" style="width:68px;height:68px;border-radius:50%;background:#fff;border:5px solid #B85C38;cursor:pointer;" aria-label="Сделать фото"></button>' +
          '<button type="button" data-cam="done" style="background:#B85C38;color:#fff;border:none;border-radius:999px;padding:12px 18px;font-weight:700;cursor:pointer;opacity:0.45;" disabled>Готово (0)</button>' +
        '</div>';

      state.overlay = ov;
      document.body.appendChild(ov);

      var videoEl = ov.querySelector('video');
      var errEl = ov.querySelector('[data-cam="err"]');
      var stripEl = ov.querySelector('[data-cam="strip"]');
      var doneBtn = ov.querySelector('[data-cam="done"]');
      var recBadge = ov.querySelector('[data-cam="recbadge"]');
      var devWrap = ov.querySelector('[data-cam="devwrap"]');
      var devSel = ov.querySelector('[data-cam="devices"]');

      function updateStrip() {
        var count = state.capturedItems.length;
        doneBtn.textContent = 'Готово (' + count + ')';
        doneBtn.disabled = count === 0;
        doneBtn.style.opacity = count === 0 ? '0.45' : '1';
        if (!count) {
          stripEl.style.display = 'none';
          stripEl.innerHTML = '';
          return;
        }
        stripEl.style.display = 'flex';
        stripEl.innerHTML = state.capturedItems.map(function (it, idx) {
          var preview = it.kind === 'video'
            ? '<div style="width:52px;height:52px;border-radius:10px;background:#2D2424;display:flex;align-items:center;justify-content:center;font-size:18px;">🎥</div>'
            : '<img src="' + it.dataUrl + '" style="width:52px;height:52px;border-radius:10px;object-fit:cover;">';
          return '<div style="position:relative;flex:0 0 auto;">' + preview +
            '<button type="button" data-del="' + idx + '" style="position:absolute;top:-5px;right:-5px;width:20px;height:20px;min-height:20px;border-radius:50%;border:none;background:#C62828;color:#fff;font-size:11px;cursor:pointer;">✕</button></div>';
        }).join('');
        stripEl.querySelectorAll('[data-del]').forEach(function (b) {
          b.onclick = function () {
            state.capturedItems.splice(Number(b.getAttribute('data-del')), 1);
            updateStrip();
          };
        });
      }

      async function bootCamera(withAudio) {
        errEl.style.display = 'none';
        try {
          var s = await acquireStream(withAudio);
          videoEl.srcObject = s;
          await videoEl.play();
          if (state.devices.length > 1) {
            devWrap.style.display = 'block';
            devSel.innerHTML = state.devices.map(function (d, idx) {
              var lbl = d.label || ('Камера ' + (idx + 1));
              var sel = d.deviceId === state.selectedDeviceId ? ' selected' : '';
              return '<option value="' + d.deviceId + '"' + sel + '>' + lbl + '</option>';
            }).join('');
          }
        } catch (err) {
          errEl.textContent = mapCameraError(err);
          errEl.style.display = 'flex';
        }
      }

      devSel.onchange = function () {
        state.selectedDeviceId = devSel.value;
        bootCamera(false);
      };

      ov.querySelector('[data-cam="close"]').onclick = function () { finish([], true); };
      ov.querySelector('[data-cam="flip"]').onclick = function () {
        state.selectedDeviceId = '';
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        bootCamera(false);
      };
      ov.querySelector('[data-cam="shutter"]').onclick = function () {
        if (!state.stream || state.recording) return;
        var item = capturePhotoFromVideo(videoEl);
        state.capturedItems.push(item);
        if (!state.multiMode) {
          finish(state.capturedItems, false);
        } else {
          updateStrip();
        }
      };
      doneBtn.onclick = function () {
        if (state.capturedItems.length > 0) finish(state.capturedItems, false);
      };

      var vidBtn = ov.querySelector('[data-cam="video"]');
      if (vidBtn) {
        vidBtn.onclick = async function () {
          if (state.recording) {
            if (state.mediaRecorder) try { state.mediaRecorder.stop(); } catch (_) {}
            return;
          }
          if (typeof MediaRecorder === 'undefined') {
            errEl.textContent = 'Запись видео не поддерживается в этом браузере. Сделайте фото.';
            errEl.style.display = 'flex';
            return;
          }
          try {
            await bootCamera(true);
            var mime = pickSupportedVideoMime();
            state.recChunks = [];
            state.mediaRecorder = mime ? new MediaRecorder(state.stream, { mimeType: mime }) : new MediaRecorder(state.stream);
            state.mediaRecorder.ondataavailable = function (ev) {
              if (ev.data && ev.data.size > 0) state.recChunks.push(ev.data);
            };
            state.mediaRecorder.onstop = function () {
              state.recording = false;
              clearInterval(state.recTimer);
              recBadge.style.display = 'none';
              vidBtn.textContent = '🎥 Видео (15с)';
              var blob = new Blob(state.recChunks, { type: mime || 'video/webm' });
              var reader = new FileReader();
              reader.onloadend = function () {
                state.capturedItems.push({
                  kind: 'video',
                  mimeType: blob.type || 'video/webm',
                  dataUrl: String(reader.result || ''),
                  durationSec: state.recSec,
                  createdAt: new Date().toISOString()
                });
                if (!state.multiMode) finish(state.capturedItems, false);
                else updateStrip();
              };
              reader.readAsDataURL(blob);
            };
            state.recSec = 0;
            state.recording = true;
            recBadge.style.display = 'block';
            recBadge.textContent = '● REC 00:00 / 00:15';
            vidBtn.textContent = '⏹ Стоп';
            state.mediaRecorder.start(250);
            state.recTimer = setInterval(function () {
              state.recSec++;
              recBadge.textContent = '● REC 00:' + String(state.recSec).padStart(2, '0') + ' / 00:' + MAX_VIDEO_SEC;
              if (state.recSec >= MAX_VIDEO_SEC && state.mediaRecorder && state.recording) {
                try { state.mediaRecorder.stop(); } catch (_) {}
              }
            }, 1000);
          } catch (err) {
            errEl.textContent = mapCameraError(err);
            errEl.style.display = 'flex';
          }
        };
      }

      bootCamera(false);
    });
  }

  // Обратная совместимость с существующими вызовами CoffeeCamera.capture / openCamera
  var api = {
    version: 'v97.0.0',
    MAX_VIDEO_SEC: MAX_VIDEO_SEC,
    prewarm: prewarm,
    open: open,
    capture: open,
    openCamera: open,
    stopStream: stopStream,
    listVideoDevices: listVideoDevices,
    mapCameraError: mapCameraError,
    pickSupportedVideoMime: pickSupportedVideoMime
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) {
    global.CoffeeCamera = api;
    global.CoffeeCameraV94 = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
