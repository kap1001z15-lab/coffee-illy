/**
 * Coffee Illy — Cross-Platform Apple Liquid Glass Camera Module (v98.7.0)
 * Единый модуль камеры с однократным запросом разрешения при входе в терминал:
 * - prewarm({ keepAlive: true }) запрашивает доступ 1 раз при входе и держит поток
 *   в энергосберегающей паузе (track.enabled = false) без повторных запросов getUserMedia
 *   на каждом шаге чек-листа (Android Telegram WebView / iOS Safari / PWA / Desktop).
 * - Фото (до 1280px JPEG 0.78) + Видео до 15 сек (MediaRecorder) без галереи.
 * - Полное освобождение камеры только при выходе из смены / закрытии вкладки.
 */
(function (global) {
  'use strict';

  var MAX_VIDEO_SEC = 15;
  var MAX_PHOTO_DIM = 1280;
  var JPEG_QUALITY = 0.78;
  var CAM_GRANTED_KEY = 'coffee_illy_v97_cam_granted';

  var ICO_CLOSE = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICO_GRID = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;"><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>';
  var ICO_CHECK = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;"><path d="M20 6 9 17l-5-5"/></svg>';
  var ICO_FLIP = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
  var ICO_VIDEO = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="3"/></svg>';
  var ICO_STOP = '<svg class="ui-ico" viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor;"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>';

  var state = {
    stream: null,
    facingMode: 'environment',
    selectedDeviceId: '',
    devices: [],
    prewarmed: false,
    keepAliveSession: false,
    recording: false,
    mediaRecorder: null,
    recChunks: [],
    recTimer: null,
    recSec: 0,
    overlay: null,
    onDone: null,
    capturedItems: [],
    multiMode: true,
    allowVideo: true,
    zoomLevel: 1,
    digitalZoom: 1
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
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/mp4;codecs=avc1.42E01E',
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

  function hasLiveStream() {
    if (!state.stream || typeof state.stream.getTracks !== 'function') return false;
    var tracks = state.stream.getTracks();
    if (!tracks || !tracks.length) return false;
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i] && (tracks[i].readyState === 'live' || tracks[i].readyState === undefined)) {
        return true;
      }
    }
    return false;
  }

  function pauseStream() {
    if (state.recTimer) {
      clearInterval(state.recTimer);
      state.recTimer = null;
    }
    if (state.mediaRecorder && state.recording) {
      try { state.mediaRecorder.stop(); } catch (_) {}
    }
    state.recording = false;
    if (state.stream && typeof state.stream.getTracks === 'function') {
      try {
        state.stream.getTracks().forEach(function (t) {
          if (t && 'enabled' in t) t.enabled = false;
        });
      } catch (_) {}
    }
  }

  function resumeStream() {
    if (state.stream && typeof state.stream.getTracks === 'function') {
      try {
        state.stream.getTracks().forEach(function (t) {
          if (t && 'enabled' in t) t.enabled = true;
        });
      } catch (_) {}
    }
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
    state.prewarmed = false;
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

  async function acquireStream(withAudio, forceNew) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Браузер не поддерживает доступ к камере (MediaDevices API).');
    }
    // Если разрешение уже получено и поток живой — мгновенно переиспользуем его без повторного запроса ОС
    if (!forceNew && !withAudio && hasLiveStream()) {
      resumeStream();
      return state.stream;
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
    state.prewarmed = true;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(CAM_GRANTED_KEY, '1'); } catch (_) {}
    await listVideoDevices();
    return state.stream;
  }

  async function prewarm(opts) {
    var keepAlive = !!(opts && opts.keepAlive);
    state.keepAliveSession = keepAlive;
    if (state.prewarmed && (!keepAlive || hasLiveStream())) {
      return { ok: true, prewarmed: true, reused: true };
    }
    try {
      var s = await acquireStream(false, false);
      var trackCount = s && typeof s.getTracks === 'function' ? s.getTracks().length : 0;
      if (keepAlive) {
        // Оставляем разрешение и поток в тихом standby-режиме: ни одного повторного запроса камеры на шагах чек-листа
        pauseStream();
      } else {
        stopStream();
        state.prewarmed = true;
      }
      return { ok: true, prewarmed: true, keepAlive: keepAlive, tracks: trackCount };
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
    var dz = Number(state.digitalZoom || 1);
    if (dz > 1.01) {
      var sw = vw / dz;
      var sh = vh / dz;
      var sx = (vw - sw) / 2;
      var sy = (vh - sh) / 2;
      ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      ctx.drawImage(videoEl, 0, 0, w, h);
    }
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

  // Полное освобождение камеры при закрытии вкладки/приложения
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window._coffeeCamLifecycleBound) {
    window._coffeeCamLifecycleBound = true;
    window.addEventListener('pagehide', stopStream);
    window.addEventListener('beforeunload', stopStream);
  }

  function open(opts) {
    opts = opts || {};
    state.multiMode = opts.multi !== false;
    state.allowVideo = opts.allowVideo !== false;
    state.capturedItems = [];
    state.zoomLevel = 1;
    state.digitalZoom = 1;
    state.onDone = typeof opts.onCapture === 'function' ? opts.onCapture : null;
    var onCapturedCb = typeof opts.onCaptured === 'function' ? opts.onCaptured : null;

    return new Promise(function (resolve) {
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
        var first = Array.isArray(out) ? out[0] : out;
        if (onCapturedCb && first && first.dataUrl) {
          try {
            onCapturedCb(first.dataUrl, {
              mediaType: first.kind === 'video' ? 'video' : 'image',
              mimeType: first.mimeType || 'image/jpeg',
              items: Array.isArray(out) ? out : [first]
            });
          } catch (_) {}
        }
        if (state.onDone && out) {
          try { state.onDone(out); } catch (_) {}
        }
        resolve(out);
      }

      function cleanupUi() {
        document.removeEventListener('visibilitychange', onVisibility);
        var vEl = state.overlay && state.overlay.querySelector ? state.overlay.querySelector('video') : null;
        if (vEl) { try { vEl.srcObject = null; } catch (_) {} }
        if (state.keepAliveSession) {
          // Сохраняем разрешение камеры активным в standby для следующего шага чек-листа
          pauseStream();
        } else {
          stopStream();
        }
        if (state.overlay && state.overlay.parentNode) {
          state.overlay.parentNode.removeChild(state.overlay);
        }
        state.overlay = null;
      }

      async function onVisibility() {
        if (!state.overlay) return;
        if (document.hidden) {
          pauseStream();
        } else {
          try {
            var v = state.overlay.querySelector('video');
            if (v) {
              var s = await acquireStream(false, false);
              v.srcObject = s;
              await v.play();
            }
          } catch (_) {}
        }
      }
      document.addEventListener('visibilitychange', onVisibility);

      var camMode = 'photo';
      var showGrid = true;
      var ov = document.createElement('div');
      ov.className = 'lg-cam-overlay ios-cam';
      ov.innerHTML =
        '<div class="lg-cam-stage">' +
          '<video autoplay playsinline muted class="lg-cam-video"></video>' +
          '<div class="lg-cam-grid is-on" data-cam="grid"><span></span><span></span><span></span><span></span></div>' +
          '<div class="lg-cam-flash" data-cam="flash"></div>' +
          '<div class="lg-cam-focus" data-cam="focus"></div>' +
          '<div class="lg-cam-top">' +
            '<button type="button" class="lg-cam-icon" data-cam="close" aria-label="Закрыть камеру">' + ICO_CLOSE + '</button>' +
            '<div class="lg-cam-title" title="' + String(opts.title || 'Камера').replace(/"/g, '&quot;') + '">' + (opts.title || 'Камера') + '</div>' +
            '<button type="button" class="lg-cam-icon is-active" data-cam="gridbtn" aria-label="Сетка кадра">' + ICO_GRID + '</button>' +
          '</div>' +
          '<div data-cam="recbadge" class="lg-cam-rec" style="display:none;">00:00</div>' +
          '<div data-cam="lenses" class="lg-cam-lenses" style="display:none;"></div>' +
          '<select data-cam="devices" class="lg-cam-select" style="display:none;"></select>' +
          '<div data-cam="err" class="lg-cam-err" style="display:none;"></div>' +
        '</div>' +
        '<div class="lg-cam-bottom">' +
          '<div data-cam="strip" class="lg-cam-strip" style="display:none;"></div>' +
          (state.allowVideo
            ? '<div class="lg-cam-modes" data-cam="modes">' +
                '<button type="button" class="lg-cam-mode is-active" data-mode="photo">ФОТО</button>' +
                '<button type="button" class="lg-cam-mode" data-mode="video" data-cam="video">ВИДЕО 15С</button>' +
              '</div>'
            : '<div class="lg-cam-modes"><span class="lg-cam-mode is-active">ФОТО</span></div>') +
          '<div class="lg-cam-dock">' +
            '<button type="button" class="lg-cam-icon lg-cam-flip-lg" data-cam="flip" aria-label="Сменить камеру">' + ICO_FLIP + '</button>' +
            '<button type="button" class="lg-cam-shutter" data-cam="shutter" aria-label="Сделать фото"><span></span></button>' +
            '<button type="button" class="lg-cam-done" data-cam="done" disabled>' + ICO_CHECK + '<span>0</span></button>' +
          '</div>' +
        '</div>';

      state.overlay = ov;
      document.body.appendChild(ov);

      var stageEl = ov.querySelector('.lg-cam-stage');
      var videoEl = ov.querySelector('video');
      var errEl = ov.querySelector('[data-cam="err"]');
      var stripEl = ov.querySelector('[data-cam="strip"]');
      var doneBtn = ov.querySelector('[data-cam="done"]');
      var shutterBtn = ov.querySelector('[data-cam="shutter"]');
      var recBadge = ov.querySelector('[data-cam="recbadge"]');
      var lensesEl = ov.querySelector('[data-cam="lenses"]');
      var devSel = ov.querySelector('[data-cam="devices"]');
      var flashEl = ov.querySelector('[data-cam="flash"]');
      var focusEl = ov.querySelector('[data-cam="focus"]');
      var gridEl = ov.querySelector('[data-cam="grid"]');
      var gridBtn = ov.querySelector('[data-cam="gridbtn"]');

      function triggerFlash() {
        if (!flashEl || !flashEl.classList) return;
        flashEl.classList.remove('is-pop');
        void flashEl.offsetWidth;
        flashEl.classList.add('is-pop');
      }

      if (stageEl && focusEl && typeof stageEl.addEventListener === 'function') {
        stageEl.addEventListener('click', function (ev) {
          if (ev.target && ev.target.closest && ev.target.closest('button,.lg-cam-lenses,.lg-cam-top')) return;
          var rect = stageEl.getBoundingClientRect();
          var x = ev.clientX - rect.left;
          var y = ev.clientY - rect.top;
          focusEl.style.left = x + 'px';
          focusEl.style.top = y + 'px';
          focusEl.classList.remove('is-pop');
          void focusEl.offsetWidth;
          focusEl.classList.add('is-pop');
        });
      }

      if (gridBtn && gridEl) {
        gridBtn.onclick = function () {
          showGrid = !showGrid;
          gridEl.classList.toggle('is-on', showGrid);
          gridBtn.classList.toggle('is-active', showGrid);
        };
      }

      function getZoomCaps() {
        try {
          var t0 = state.stream && state.stream.getVideoTracks && state.stream.getVideoTracks()[0];
          if (t0 && typeof t0.getCapabilities === 'function') {
            var caps = t0.getCapabilities();
            if (caps && caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number' && caps.zoom.max > caps.zoom.min) {
              return caps.zoom;
            }
          }
        } catch (_) {}
        return null;
      }

      async function applyLensZoom(targetZ) {
        var z = Number(targetZ) || 1;
        state.zoomLevel = z;
        var caps = getZoomCaps();
        var appliedHw = false;
        if (caps) {
          try {
            var t0 = state.stream && state.stream.getVideoTracks && state.stream.getVideoTracks()[0];
            if (t0 && typeof t0.applyConstraints === 'function') {
              var clamped = Math.max(caps.min, Math.min(caps.max, z));
              await t0.applyConstraints({ advanced: [{ zoom: clamped }] });
              appliedHw = Math.abs(clamped - z) < 0.05;
              state.digitalZoom = appliedHw ? 1 : Math.max(1, z / Math.max(0.5, clamped));
            }
          } catch (_) {
            appliedHw = false;
          }
        }
        if (!appliedHw) {
          state.digitalZoom = Math.max(1, z);
        }
        if (videoEl && videoEl.style) {
          videoEl.style.transition = 'transform 160ms ease';
          videoEl.style.transform = state.digitalZoom > 1.01 ? ('scale(' + state.digitalZoom + ')') : '';
        }
        renderLensPills();
      }

      function renderLensPills() {
        if (!lensesEl) return;
        if (state.facingMode === 'user') {
          lensesEl.style.display = 'none';
          return;
        }
        // Переключение объективов/зума идёт на ТЕКУЩЕМ потоке (applyConstraints / цифровой зум)
        // без повторного вызова getUserMedia — Telegram больше не спрашивает разрешение камеры!
        var caps = getZoomCaps();
        var levels = (caps && caps.min <= 0.7) ? [0.5, 1, 2] : [1, 1.5, 2];
        lensesEl.style.display = 'inline-flex';
        lensesEl.innerHTML = levels.map(function (z) {
          var isAct = Math.abs(Number(state.zoomLevel || 1) - z) < 0.05;
          var lbl = (z === 0.5 ? '0.5×' : (z === 1.5 ? '1.5×' : (z + '×')));
          return '<button type="button" class="lg-cam-lens' + (isAct ? ' is-active' : '') + '" data-zoom="' + z + '">' + lbl + '</button>';
        }).join('');
        lensesEl.querySelectorAll('[data-zoom]').forEach(function (btn) {
          btn.onclick = function () {
            if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
            applyLensZoom(Number(btn.getAttribute('data-zoom')) || 1);
          };
        });
      }

      function updateStrip() {
        var count = state.capturedItems.length;
        doneBtn.innerHTML = count > 0 ? (ICO_CHECK + '<span>Готово · ' + count + '</span>') : (ICO_CHECK + '<span>0</span>');
        doneBtn.disabled = count === 0;
        if (doneBtn && doneBtn.classList) doneBtn.classList.toggle('has-items', count > 0);
        if (!count) {
          stripEl.style.display = 'none';
          stripEl.innerHTML = '';
          return;
        }
        stripEl.style.display = 'flex';
        stripEl.innerHTML = state.capturedItems.map(function (it, idx) {
          var preview = it.kind === 'video'
            ? '<div class="lg-cam-thumb-vid">' + ICO_VIDEO + '</div>'
            : '<img src="' + it.dataUrl + '" class="lg-cam-thumb-img">';
          return '<div class="lg-cam-thumb">' + preview +
            '<button type="button" class="lg-cam-thumb-del" data-del="' + idx + '" aria-label="Удалить">' + ICO_CLOSE + '</button></div>';
        }).join('');
        stripEl.querySelectorAll('[data-del]').forEach(function (b) {
          b.onclick = function () {
            state.capturedItems.splice(Number(b.getAttribute('data-del')), 1);
            updateStrip();
          };
        });
      }

      function syncModeUi() {
        (typeof ov.querySelectorAll === 'function' ? ov.querySelectorAll('.lg-cam-mode[data-mode]') : []).forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-mode') === camMode);
        });
        shutterBtn.classList.toggle('is-video', camMode === 'video');
        shutterBtn.classList.toggle('is-recording', !!state.recording);
        shutterBtn.setAttribute('aria-label', camMode === 'video' ? (state.recording ? 'Остановить запись' : 'Начать запись видео') : 'Сделать фото');
      }

      async function toggleVideoRecording() {
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
          await bootCamera(false, false);
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
            syncModeUi();
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
          recBadge.style.display = 'inline-flex';
          recBadge.textContent = '● 00:00 / 00:' + MAX_VIDEO_SEC;
          syncModeUi();
          state.mediaRecorder.start(250);
          state.recTimer = setInterval(function () {
            state.recSec++;
            recBadge.textContent = '● 00:' + String(state.recSec).padStart(2, '0') + ' / 00:' + MAX_VIDEO_SEC;
            if (state.recSec >= MAX_VIDEO_SEC && state.mediaRecorder && state.recording) {
              try { state.mediaRecorder.stop(); } catch (_) {}
            }
          }, 1000);
        } catch (err) {
          errEl.textContent = mapCameraError(err);
          errEl.style.display = 'flex';
        }
      }

      async function bootCamera(withAudio, forceNew) {
        errEl.style.display = 'none';
        try {
          var s = await acquireStream(withAudio, forceNew);
          videoEl.srcObject = s;
          await videoEl.play();
          if (state.devices.length > 1) {
            devSel.innerHTML = state.devices.map(function (d, idx) {
              var lbl = d.label || ('Камера ' + (idx + 1));
              var sel = d.deviceId === state.selectedDeviceId ? ' selected' : '';
              return '<option value="' + d.deviceId + '"' + sel + '>' + lbl + '</option>';
            }).join('');
          }
          renderLensPills();
        } catch (err) {
          errEl.textContent = mapCameraError(err);
          errEl.style.display = 'flex';
        }
      }

      devSel.onchange = function () {
        state.selectedDeviceId = devSel.value;
        bootCamera(false, true);
      };

      (typeof ov.querySelectorAll === 'function' ? ov.querySelectorAll('.lg-cam-mode[data-mode]') : []).forEach(function (btn) {
        btn.onclick = function () {
          if (state.recording) return;
          camMode = btn.getAttribute('data-mode') || 'photo';
          if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
          syncModeUi();
        };
      });

      ov.querySelector('[data-cam="close"]').onclick = function () { finish([], true); };
      ov.querySelector('[data-cam="flip"]').onclick = function () {
        state.selectedDeviceId = '';
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        state.zoomLevel = 1;
        state.digitalZoom = 1;
        if (videoEl && videoEl.style) videoEl.style.transform = '';
        if (global && global.CoffeeHaptic && global.CoffeeHaptic.select) global.CoffeeHaptic.select();
        bootCamera(false, true);
      };
      shutterBtn.onclick = function () {
        if (camMode === 'video') {
          toggleVideoRecording();
          return;
        }
        if (!state.stream || state.recording) return;
        if (global && global.CoffeeHaptic && global.CoffeeHaptic.impact) global.CoffeeHaptic.impact('medium');
        triggerFlash();
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

      bootCamera(false, false);
    });
  }

  var api = {
    version: 'v98.7.0',
    MAX_VIDEO_SEC: MAX_VIDEO_SEC,
    prewarm: prewarm,
    open: open,
    capture: open,
    openCamera: open,
    pauseStream: pauseStream,
    stopStream: stopStream,
    stop: stopStream,
    hasLiveStream: hasLiveStream,
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
