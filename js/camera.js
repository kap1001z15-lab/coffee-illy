/* =========================================================================
   КАМЕРА (v57): Основная и фронтальная камеры + Вспышка (аппаратный LED-фонарик
   torch + экранная Retina-вспышка для селфи и iOS) + пул тёплого потока (1 запрос).
   Использование:
     window.coffeeCameraPool.acquire(facing) -> Promise<MediaStream>
     window.coffeeCameraPool.setTorch(stream, on) -> Promise<boolean>
     window.coffeeCameraPool.suspend(stream) -> пауза без отзыва разрешения
     window.coffeeCamera.open({ mode: 'photo'|'video', facing: 'environment'|'user', flash: false, stamp: '...' })
   ========================================================================= */
(function () {
  'use strict';
  const VID_MAX = 15; // секунд
  const CAM_GRANTED_KEY = 'coffee_cam_granted_v1';
  const CAM_NATIVE_KEY = 'coffee_cam_native_mode_v1';
  let busy = false;

  // Хранилище активных потоков камеры на время сессии
  const _warmStreams = { environment: null, user: null };

  function _isStreamAlive(s) {
    if (!s || typeof s.getVideoTracks !== 'function') return false;
    const tracks = s.getVideoTracks();
    return tracks.length > 0 && tracks.every((t) => t && t.readyState === 'live');
  }

  function _enableStreamTracks(s, enabled) {
    if (!s || typeof s.getTracks !== 'function') return;
    s.getTracks().forEach((t) => {
      try { t.enabled = !!enabled; } catch (_) {}
    });
  }

  function _stopStreamCompletely(s) {
    if (!s || typeof s.getTracks !== 'function') return;
    s.getTracks().forEach((t) => {
      try {
        if (typeof t.applyConstraints === 'function') {
          t.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
      } catch (_) {}
      try { t.stop(); } catch (_) {}
    });
  }

  async function setStreamTorch(s, on) {
    if (!s || typeof s.getVideoTracks !== 'function') return false;
    const tracks = s.getVideoTracks();
    if (!tracks.length) return false;
    const t = tracks[0];
    if (!t || typeof t.applyConstraints !== 'function') return false;
    try {
      const caps = typeof t.getCapabilities === 'function' ? (t.getCapabilities() || {}) : {};
      if (caps.torch || ('torch' in caps)) {
        await t.applyConstraints({ advanced: [{ torch: !!on }] });
        return true;
      }
      // Пробуем применить constraint напрямую (на части Android WebView getCapabilities не возвращает torch, но applyConstraints работает)
      await t.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch (_) {
      return false;
    }
  }

  function hasHardwareTorch(s) {
    if (!s || typeof s.getVideoTracks !== 'function') return false;
    const t = s.getVideoTracks()[0];
    if (!t || typeof t.getCapabilities !== 'function') return false;
    try {
      const caps = t.getCapabilities() || {};
      return !!(caps.torch || ('torch' in caps));
    } catch (_) {
      return false;
    }
  }

  async function _findCameraDeviceId(facing) {
    if (!(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function')) {
      return null;
    }
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = (list || []).filter((d) => d && d.kind === 'videoinput');
      if (vids.length < 2) return null;
      const re = facing === 'user'
        ? /front|user|selfie|facetime|передн|фронт/i
        : /back|rear|environment|main|wide|0|задн|основн/i;
      const match = vids.find((d) => re.test(String(d.label || '')));
      if (match && match.deviceId) return match.deviceId;
      // На большинстве смартфонов [0] — основная, [vids.length - 1] — фронтальная
      return facing === 'user' ? vids[vids.length - 1].deviceId : vids[0].deviceId;
    } catch (_) {
      return null;
    }
  }

  async function acquireWarmStream(facingOpt) {
    const facing = facingOpt === 'user' ? 'user' : 'environment';
    const alt = facing === 'user' ? 'environment' : 'user';

    // Приостанавливаем альтернативный поток и гасим на нём фонарик
    if (_warmStreams[alt]) {
      await setStreamTorch(_warmStreams[alt], false);
      _enableStreamTracks(_warmStreams[alt], false);
    }

    // 1. Если поток для нужной камеры уже открыт и жив — мгновенно включаем его (0 запросов getUserMedia)
    if (_isStreamAlive(_warmStreams[facing])) {
      _enableStreamTracks(_warmStreams[facing], true);
      return _warmStreams[facing];
    }
    if (_warmStreams[facing]) {
      _stopStreamCompletely(_warmStreams[facing]);
      _warmStreams[facing] = null;
    }

    if (!(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')) {
      throw new Error('NO_GET_USER_MEDIA');
    }

    const tries = [
      { video: { facingMode: { exact: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
    ];

    const devId = await _findCameraDeviceId(facing);
    if (devId) {
      tries.splice(1, 0, { video: { deviceId: { exact: devId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    }
    tries.push({ video: true, audio: false });

    let s = null, lastErr = null;
    for (let i = 0; i < tries.length; i++) {
      const c = tries[i];
      try {
        s = await navigator.mediaDevices.getUserMedia(c);
        if (s) break;
      } catch (e) {
        lastErr = e;
        if (e && /NotAllowed|Permission|Security/i.test(String(e.name || ''))) break;
        // На многих телефонах Android/iOS нельзя держать открытыми фронтальную и основную камеры одновременно:
        // освобождаем старый поток другой камеры и сразу повторяем попытку
        if (_warmStreams[alt]) {
          _stopStreamCompletely(_warmStreams[alt]);
          _warmStreams[alt] = null;
          try {
            s = await navigator.mediaDevices.getUserMedia(c);
            if (s) break;
          } catch (e2) {
            lastErr = e2;
          }
        }
      }
    }
    if (!s) {
      if (_isStreamAlive(_warmStreams[alt])) {
        _enableStreamTracks(_warmStreams[alt], true);
        return _warmStreams[alt];
      }
      throw lastErr || new Error('NO_CAMERA');
    }

    _warmStreams[facing] = s;
    try { localStorage.setItem(CAM_GRANTED_KEY, '1'); } catch (_) {}
    return s;
  }

  function suspendWarmStream(streamOpt) {
    if (streamOpt) {
      setStreamTorch(streamOpt, false);
      _enableStreamTracks(streamOpt, false);
    }
    Object.keys(_warmStreams).forEach((k) => {
      if (_warmStreams[k]) {
        setStreamTorch(_warmStreams[k], false);
        _enableStreamTracks(_warmStreams[k], false);
      }
    });
  }

  function releaseAllWarmStreams() {
    Object.keys(_warmStreams).forEach((k) => {
      if (_warmStreams[k]) {
        _stopStreamCompletely(_warmStreams[k]);
        _warmStreams[k] = null;
      }
    });
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', releaseAllWarmStreams);
    window.addEventListener('beforeunload', releaseAllWarmStreams);
  }

  // Программная подсветка тёмных кадров при включённой вспышке (если съёмка шла в темноте с экранной вспышкой)
  function enhanceFlashExposure(c) {
    try {
      const ctx = c.getContext('2d');
      const sample = document.createElement('canvas');
      sample.width = sample.height = 16;
      const sCtx = sample.getContext('2d');
      sCtx.drawImage(c, 0, 0, 16, 16);
      const d = sCtx.getImageData(0, 0, 16, 16).data;
      let lum = 0;
      for (let i = 0; i < d.length; i += 4) {
        lum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      }
      const avgLum = lum / (d.length / 4);
      if (avgLum < 85) {
        const boost = avgLum < 45 ? 1.42 : 1.24;
        const copy = document.createElement('canvas');
        copy.width = c.width;
        copy.height = c.height;
        copy.getContext('2d').drawImage(c, 0, 0);
        ctx.save();
        ctx.filter = 'brightness(' + boost + ') contrast(1.06)';
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
    } catch (_) {}
    return c;
  }

  function stampCanvas(c, stampStr) {
    const x = c.getContext('2d');
    const h = Math.max(16, Math.round(c.width / 45));
    x.fillStyle = 'rgba(0,0,0,.58)';
    x.fillRect(0, c.height - h * 1.9, c.width, h * 1.9);
    x.fillStyle = '#fff';
    x.font = '600 ' + h + 'px system-ui,sans-serif';
    const text = new Date().toLocaleString('ru-RU') + (stampStr ? ' · ' + stampStr : '');
    x.fillText(text, h * 0.6, c.height - h * 0.6);
    return c;
  }

  // Экранная Retina-вспышка (для фронтальной камеры и устройств без аппаратного WebRTC torch)
  function triggerScreenFlash(flashEl, durationMs) {
    return new Promise((resolve) => {
      if (!flashEl) return resolve();
      flashEl.hidden = false;
      flashEl.style.display = 'block';
      flashEl.style.opacity = '0.96';
      setTimeout(() => {
        resolve();
        setTimeout(() => {
          flashEl.style.opacity = '0';
          setTimeout(() => {
            flashEl.hidden = true;
            flashEl.style.display = 'none';
          }, 150);
        }, 90);
      }, Math.max(180, Number(durationMs) || 260));
    });
  }

  // Прямой захват через системную камеру устройства (<input capture>) — в системном приложении камеры работают обе камеры и родная вспышка
  function captureNativeCanvas(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (typeof document === 'undefined' || !document.body) return resolve(null);
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = opts.mode === 'video' ? 'video/*,image/*' : 'image/*';
      inp.setAttribute('capture', opts.facing === 'user' ? 'user' : 'environment');
      inp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(inp);

      let settled = false;
      const done = (res) => {
        if (settled) return;
        settled = true;
        try { inp.remove(); } catch (_) {}
        resolve(res || null);
      };

      inp.addEventListener('cancel', () => done(null));
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        if (!f) return done(null);
        if (/^video\//i.test(f.type || '')) {
          const fr = new FileReader();
          fr.onload = () => done({ kind: 'video', dataUrl: String(fr.result || ''), canvas: null });
          fr.onerror = () => done(null);
          fr.readAsDataURL(f);
          return;
        }
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => {
          try { URL.revokeObjectURL(url); } catch (_) {}
          const w0 = img.naturalWidth || img.width || 1280;
          const h0 = img.naturalHeight || img.height || 720;
          const k = Math.min(1, 1280 / w0);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w0 * k));
          c.height = Math.max(1, Math.round(h0 * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          if (opts.stamp !== false) stampCanvas(c, opts.stamp || '');
          done({ kind: 'photo', canvas: c, dataUrl: c.toDataURL('image/jpeg', 0.74) });
        };
        img.onerror = () => {
          try { URL.revokeObjectURL(url); } catch (_) {}
          done(null);
        };
        img.src = url;
      });

      try {
        inp.click();
      } catch (_) {
        done(null);
      }
    });
  }

  async function captureNative(opts) {
    const res = await captureNativeCanvas(opts);
    return res ? res.dataUrl : null;
  }

  function isNativeModePreferred() {
    try { return localStorage.getItem(CAM_NATIVE_KEY) === '1'; } catch (_) { return false; }
  }
  function setNativeModePreferred(val) {
    try {
      if (val) localStorage.setItem(CAM_NATIVE_KEY, '1');
      else localStorage.removeItem(CAM_NATIVE_KEY);
    } catch (_) {}
  }

  window.coffeeCameraPool = {
    acquire: acquireWarmStream,
    suspend: suspendWarmStream,
    releaseAll: releaseAllWarmStreams,
    setTorch: setStreamTorch,
    hasTorch: hasHardwareTorch,
    triggerScreenFlash,
    enhanceFlashExposure,
    captureNativeCanvas,
    captureNative,
    isNativeModePreferred,
    setNativeModePreferred
  };

  function mk(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function pickMime() {
    if (!window.MediaRecorder) return null;
    for (const m of ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
      try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
    }
    return '';
  }
  function isBlack(c) {
    const t = document.createElement('canvas'); t.width = t.height = 8;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) < 10;
  }

  function open(opts) {
    opts = opts || {};
    if (isNativeModePreferred()) {
      return captureNative(opts);
    }
    return new Promise((resolve) => {
      if (busy) return resolve(null);
      busy = true;

      let facing = opts.facing === 'user' ? 'user' : 'environment';
      let mode = opts.mode === 'video' ? 'video' : 'photo';
      let flashOn = !!opts.flash;
      let hwTorchActive = false;
      let stream = null, rec = null, chunks = [], recTimer = null, closed = false;

      const ov = mk('dialog', 'position:fixed;inset:0;margin:0;padding:0;border:0;max-width:none;max-height:none;width:100%;height:100%;z-index:2147483000;background:#000;color:#fff;display:flex;flex-direction:column;font-family:system-ui,sans-serif;touch-action:manipulation;overflow:hidden');
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Камера');
      const video = mk('video', 'flex:1;min-height:0;width:100%;object-fit:cover;background:#000');
      video.autoplay = true; video.muted = true; video.setAttribute('playsinline', '');
      const screenFlashEl = mk('div', 'position:fixed;inset:0;z-index:2147483005;background:#fffdf6;opacity:0;pointer-events:none;transition:opacity .12s ease;display:none');

      const top = mk('div', 'position:absolute;top:0;left:0;right:0;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top,0px) + 12px) 12px 12px;background:linear-gradient(#000c,#0000);z-index:2');
      const bClose = mk('button', 'border:0;border-radius:999px;background:#0009;color:#fff;font-size:14px;font-weight:700;padding:8px 13px;cursor:pointer', '✕ Отмена');
      const bFlash = mk('button', '', '⚡ Вспышка: Выкл');
      const bNative = mk('button', 'border:1px solid rgba(255,255,255,.28);border-radius:999px;background:#0009;color:#fff;font-size:12px;font-weight:600;padding:8px 11px;cursor:pointer', '📱 Системная');
      bClose.type = bFlash.type = bNative.type = 'button';
      top.append(bClose, bFlash, bNative);

      const info = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 62px);left:0;right:0;text-align:center;font-size:13px;font-weight:600;text-shadow:0 1px 4px #000;padding:0 16px;z-index:2');
      const rect = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 62px);left:50%;transform:translateX(-50%);display:none;background:#d32f2f;border-radius:999px;padding:4px 14px;font-weight:700;font-size:15px;z-index:2');

      const bottom = mk('div', 'position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 14px calc(env(safe-area-inset-bottom,0px) + 20px);background:linear-gradient(#0000,#000d);z-index:2');
      const lensRow = mk('div', 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center');
      const bRear = mk('button', '', '📷 Основная');
      const bFront = mk('button', '', '🤳 Фронтальная');
      bRear.type = bFront.type = 'button';
      lensRow.append(bRear, bFront);

      const modes = mk('div', 'display:flex;gap:8px');
      const mPhoto = mk('button', '', 'Фото'), mVideo = mk('button', '', 'Видео');
      mPhoto.type = mVideo.type = 'button';
      modes.append(mPhoto, mVideo);

      const shutterRow = mk('div', 'display:flex;align-items:center;justify-content:center;gap:24px;width:100%');
      const shutter = mk('button', 'width:74px;height:74px;border-radius:50%;border:5px solid #fff;background:#fff3;cursor:pointer;padding:0');
      const bFlip = mk('button', 'border:1px solid rgba(255,255,255,.28);border-radius:999px;background:#0009;color:#fff;font-size:13.5px;font-weight:700;padding:9px 14px;cursor:pointer', '🔄 Сменить');
      shutter.type = bFlip.type = 'button';
      shutter.disabled = true; shutter.setAttribute('aria-label', 'Снять');
      shutterRow.append(shutter, bFlip);

      bottom.append(lensRow, modes, shutterRow);
      ov.append(video, screenFlashEl, top, info, rect, bottom);
      document.body.appendChild(ov);
      try { if (typeof ov.showModal === 'function') ov.showModal(); else ov.setAttribute('open', ''); } catch (_) { ov.setAttribute('open', ''); }
      ov.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      const onHide = () => { if (document.hidden) finish(null); };
      document.addEventListener('visibilitychange', onHide);

      function paintControls() {
        const pillOn = 'border:0;border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;background:#fff;color:#000';
        const pillOff = 'border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer;background:#0008;color:#fff';
        mPhoto.style.cssText = mode === 'photo' ? pillOn : pillOff;
        mVideo.style.cssText = mode === 'video' ? pillOn : pillOff;
        bRear.style.cssText = facing === 'environment' ? pillOn : pillOff;
        bFront.style.cssText = facing === 'user' ? pillOn : pillOff;
        bFlash.style.cssText = flashOn
          ? 'border:0;border-radius:999px;padding:8px 13px;font-weight:700;font-size:13px;cursor:pointer;background:#f5b82e;color:#1b160d'
          : 'border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:8px 13px;font-weight:600;font-size:13px;cursor:pointer;background:#0009;color:#fff';
        bFlash.textContent = flashOn ? '⚡ Вспышка: Вкл' : '⚡ Вспышка: Выкл';
        shutter.style.background = mode === 'video' ? '#d32f2f' : '#fff3';
        // При включённой вспышке на фронтальной камере даём мягкую подсветку рамки видоискателя
        video.style.boxShadow = (flashOn && (facing === 'user' || !hwTorchActive))
          ? 'inset 0 0 0 14px rgba(255,253,244,0.88)'
          : 'none';
      }

      function say(t, bad) { info.textContent = t || ''; info.style.color = bad ? '#ff8a80' : '#fff'; }

      async function applyFlashState() {
        if (!stream) { hwTorchActive = false; paintControls(); return; }
        if (flashOn && facing === 'environment') {
          hwTorchActive = await setStreamTorch(stream, true);
        } else {
          hwTorchActive = false;
          await setStreamTorch(stream, false);
        }
        paintControls();
      }

      function detachStream() {
        try { video.pause(); } catch (_) {}
        video.srcObject = null;
        suspendWarmStream(stream);
        stream = null;
      }
      function finish(result) {
        if (closed) return; closed = true;
        clearInterval(recTimer);
        if (rec && rec.state === 'recording') { rec.onstop = null; try { rec.stop(); } catch (_) {} }
        detachStream();
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('visibilitychange', onHide);
        try { if (ov.open && ov.close) ov.close(); } catch (_) {}
        try { ov.remove(); } catch (_) {}
        busy = false;
        resolve(result || null);
      }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(null); } }
      document.addEventListener('keydown', onKey, true);

      async function startStream() {
        shutter.disabled = true;
        const s = await acquireWarmStream(facing);
        if (closed) { suspendWarmStream(s); return; }
        stream = s;
        video.srcObject = s;
        video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
        try { await video.play(); } catch (_) {}
        await new Promise((r) => { if (video.videoWidth) return r(); video.onloadedmetadata = () => r(); setTimeout(r, 1500); });
        shutter.disabled = !video.videoWidth;
        await applyFlashState();
      }

      async function switchFacing(targetFacing) {
        if (rec && rec.state === 'recording') return;
        const prev = facing;
        facing = targetFacing === 'user' ? 'user' : 'environment';
        paintControls();
        try {
          await startStream();
          say('');
        } catch (e) {
          facing = prev;
          paintControls();
          try { await startStream(); } catch (_) {}
        }
      }

      async function takePhoto(n) {
        if (!video.videoWidth) return;
        if (flashOn && (facing === 'user' || !hwTorchActive)) {
          await triggerScreenFlash(screenFlashEl, 260);
        }
        const k = Math.min(1, 1280 / video.videoWidth), c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        if (isBlack(c) && n < 2) return void setTimeout(() => takePhoto(n + 1), 180);
        if (flashOn) enhanceFlashExposure(c);
        stampCanvas(c, opts.stamp || '');
        finish(c.toDataURL('image/jpeg', 0.74));
      }

      function toggleRec() {
        if (rec && rec.state === 'recording') { rec.stop(); return; }
        const mime = pickMime();
        if (mime === null) { say('Запись видео не поддерживается — снимите фото', true); return; }
        chunks = [];
        try { rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: 1200000 }, mime ? { mimeType: mime } : {})); }
        catch (_) { say('Не удалось начать запись видео', true); return; }
        const r = rec;
        r.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        r.onstop = () => {
          clearInterval(recTimer);
          const blob = new Blob(chunks, { type: (r.mimeType || mime || 'video/webm').split(';')[0] });
          if (!blob.size) { rect.style.display = 'none'; shutter.style.borderRadius = '50%'; say('Видео не записалось — попробуйте ещё раз', true); return; }
          const fr = new FileReader();
          fr.onload = () => finish(String(fr.result || ''));
          fr.readAsDataURL(blob);
        };
        r.start(500);
        const t0 = Date.now();
        rect.style.display = 'block'; rect.textContent = '● 0:00';
        shutter.style.borderRadius = '14px';
        bFlip.disabled = bRear.disabled = bFront.disabled = mPhoto.disabled = mVideo.disabled = true;
        recTimer = setInterval(() => {
          const sec = Math.floor((Date.now() - t0) / 1000);
          rect.textContent = '● ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' / 0:' + VID_MAX;
          if (sec >= VID_MAX && r.state === 'recording') r.stop();
        }, 250);
      }

      bClose.onclick = () => finish(null);
      bFlash.onclick = async () => {
        flashOn = !flashOn;
        await applyFlashState();
      };
      bNative.onclick = async () => {
        const natUrl = await captureNative({ mode, facing, stamp: opts.stamp });
        finish(natUrl);
      };
      bRear.onclick = () => switchFacing('environment');
      bFront.onclick = () => switchFacing('user');
      bFlip.onclick = () => switchFacing(facing === 'user' ? 'environment' : 'user');
      mPhoto.onclick = () => { mode = 'photo'; paintControls(); say(''); };
      mVideo.onclick = () => { mode = 'video'; paintControls(); say('Видео до ' + VID_MAX + ' сек'); };
      shutter.onclick = () => { if (mode === 'video') toggleRec(); else takePhoto(0); };

      paintControls();
      startStream().then(() => { if (!closed) say(''); })
        .catch(async () => {
          if (closed) return;
          const natUrl = await captureNative({ mode, facing, stamp: opts.stamp });
          finish(natUrl);
        });
    });
  }

  window.coffeeCamera = { open };
})();
