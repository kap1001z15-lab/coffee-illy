/* =========================================================================
   КАМЕРА (v56): Единый пул «тёплого» потока (1 запрос доступа за всю смену)
   + режим прямой системной камеры без браузерных запросов разрешений.
   Использование:
     window.coffeeCameraPool.acquire(facing) -> Promise<MediaStream>
     window.coffeeCameraPool.suspend(stream) -> пауза без отзыва разрешения
     window.coffeeCameraPool.captureNative({ mode, facing, stamp }) -> Promise<string|null>
     window.coffeeCamera.open({ mode: 'photo' | 'video', facing: 'environment' | 'user', stamp: '...' })
   ========================================================================= */
(function () {
  'use strict';
  const VID_MAX = 15; // секунд
  const CAM_GRANTED_KEY = 'coffee_cam_granted_v1';
  const CAM_NATIVE_KEY = 'coffee_cam_native_mode_v1';
  let busy = false;

  // Хранилище активных потоков камеры на время сессии (чтобы WebView/браузер не спрашивал доступ повторно)
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
      try { t.stop(); } catch (_) {}
    });
  }

  async function acquireWarmStream(facingOpt) {
    const facing = facingOpt === 'user' ? 'user' : 'environment';
    // 1. Если поток для нужной камеры уже открыт и жив — мгновенно включаем его без нового запроса getUserMedia!
    if (_isStreamAlive(_warmStreams[facing])) {
      _enableStreamTracks(_warmStreams[facing], true);
      return _warmStreams[facing];
    }
    // Очищаем мёртвый поток, если он завершился
    if (_warmStreams[facing]) {
      _stopStreamCompletely(_warmStreams[facing]);
      _warmStreams[facing] = null;
    }

    if (!(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')) {
      throw new Error('NO_GET_USER_MEDIA');
    }

    const tries = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false }
    ];
    let s = null, lastErr = null;
    for (const c of tries) {
      try {
        s = await navigator.mediaDevices.getUserMedia(c);
        if (s) break;
      } catch (e) {
        lastErr = e;
        if (e && /NotAllowed|Permission|Security/i.test(String(e.name || ''))) break;
      }
    }
    if (!s) {
      // Если вторая камера недоступна, но есть живой поток другой камеры — используем его
      const alt = facing === 'user' ? 'environment' : 'user';
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
    // Не вызываем track.stop() при закрытии окна камеры, чтобы Telegram Mini App / мобильный браузер
    // сохранял выданное разрешение до конца смены и открывал камеру за 0 мс на следующих шагах!
    if (streamOpt) _enableStreamTracks(streamOpt, false);
    Object.keys(_warmStreams).forEach((k) => {
      if (_warmStreams[k]) _enableStreamTracks(_warmStreams[k], false);
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

  // Прямой захват через системную камеру устройства (<input capture>) — 0 всплывающих запросов разрешений от браузера
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
      let stream = null, rec = null, chunks = [], recTimer = null, closed = false;

      const ov = mk('dialog', 'position:fixed;inset:0;margin:0;padding:0;border:0;max-width:none;max-height:none;width:100%;height:100%;z-index:2147483000;background:#000;color:#fff;display:flex;flex-direction:column;font-family:system-ui,sans-serif;touch-action:manipulation;overflow:hidden');
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Камера');
      const video = mk('video', 'flex:1;min-height:0;width:100%;object-fit:cover;background:#000');
      video.autoplay = true; video.muted = true; video.setAttribute('playsinline', '');
      const top = mk('div', 'position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 12px;background:linear-gradient(#000a,#0000)');
      const bClose = mk('button', 'border:0;border-radius:999px;background:#0008;color:#fff;font-size:15px;font-weight:700;padding:9px 14px;cursor:pointer', '✕ Отмена');
      const bNative = mk('button', 'border:1px solid rgba(255,255,255,.28);border-radius:999px;background:#0008;color:#fff;font-size:12.5px;font-weight:600;padding:8px 12px;cursor:pointer', '⚡ Без запросов');
      const bFlip = mk('button', 'border:0;border-radius:999px;background:#0008;color:#fff;font-size:14px;font-weight:700;padding:9px 14px;cursor:pointer');
      bClose.type = bNative.type = bFlip.type = 'button';
      bNative.title = 'Открыть системную камеру устройства без запросов разрешений в браузере';
      top.append(bClose, bNative, bFlip);
      const info = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 62px);left:0;right:0;text-align:center;font-size:13.5px;font-weight:600;text-shadow:0 1px 4px #000;padding:0 16px');
      const rect = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 62px);left:50%;transform:translateX(-50%);display:none;background:#d32f2f;border-radius:999px;padding:4px 14px;font-weight:700;font-size:15px');
      const bottom = mk('div', 'position:absolute;bottom:0;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:14px;padding:16px 14px calc(env(safe-area-inset-bottom,0px) + 22px);background:linear-gradient(#0000,#000b)');
      const modes = mk('div', 'display:flex;gap:8px');
      const mPhoto = mk('button', '', '📷 Фото'), mVideo = mk('button', '', '📹 Видео');
      mPhoto.type = mVideo.type = 'button';
      modes.append(mPhoto, mVideo);
      const shutter = mk('button', 'width:74px;height:74px;border-radius:50%;border:5px solid #fff;background:#fff3;cursor:pointer;padding:0');
      shutter.type = 'button'; shutter.disabled = true; shutter.setAttribute('aria-label', 'Снять');
      bottom.append(modes, shutter);
      ov.append(video, top, info, rect, bottom);
      document.body.appendChild(ov);
      try { if (typeof ov.showModal === 'function') ov.showModal(); else ov.setAttribute('open', ''); } catch (_) { ov.setAttribute('open', ''); }
      ov.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      const onHide = () => { if (document.hidden) finish(null); };
      document.addEventListener('visibilitychange', onHide);

      function paintModes() {
        const on = 'border:0;border-radius:999px;padding:8px 16px;font-weight:700;font-size:14px;cursor:pointer;background:#fff;color:#000';
        const off = 'border:0;border-radius:999px;padding:8px 16px;font-weight:700;font-size:14px;cursor:pointer;background:#0008;color:#fff';
        mPhoto.style.cssText = mode === 'photo' ? on : off;
        mVideo.style.cssText = mode === 'video' ? on : off;
        shutter.style.background = mode === 'video' ? '#d32f2f' : '#fff3';
        bFlip.textContent = facing === 'user' ? '🔄 Основная' : '🤳 Селфи';
      }
      function say(t, bad) { info.textContent = t || ''; info.style.color = bad ? '#ff8a80' : '#fff'; }

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
      }

      function takePhoto(n) {
        if (!video.videoWidth) return;
        const k = Math.min(1, 1280 / video.videoWidth), c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        if (isBlack(c) && n < 2) return void setTimeout(() => takePhoto(n + 1), 180);
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
        bFlip.disabled = mPhoto.disabled = mVideo.disabled = true;
        recTimer = setInterval(() => {
          const sec = Math.floor((Date.now() - t0) / 1000);
          rect.textContent = '● ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' / 0:' + VID_MAX;
          if (sec >= VID_MAX && r.state === 'recording') r.stop();
        }, 250);
      }

      bClose.onclick = () => finish(null);
      bNative.onclick = async () => {
        setNativeModePreferred(true);
        const natUrl = await captureNative({ mode, facing, stamp: opts.stamp });
        finish(natUrl);
      };
      mPhoto.onclick = () => { mode = 'photo'; paintModes(); say(''); };
      mVideo.onclick = () => { mode = 'video'; paintModes(); say('Видео до ' + VID_MAX + ' сек'); };
      shutter.onclick = () => { if (mode === 'video') toggleRec(); else takePhoto(0); };
      bFlip.onclick = async () => {
        if (rec && rec.state === 'recording') return;
        const prev = facing; facing = prev === 'user' ? 'environment' : 'user'; paintModes();
        try { await startStream(); }
        catch (e) {
          facing = prev; paintModes();
          try { await startStream(); } catch (_) {}
        }
      };

      paintModes();
      startStream().then(() => { if (!closed) say(''); })
        .catch(async () => {
          if (closed) return;
          // Автоматический бесшовный переход на системную камеру без ошибок и всплывающих окон
          const natUrl = await captureNative({ mode, facing, stamp: opts.stamp });
          finish(natUrl);
        });
    });
  }

  window.coffeeCamera = { open };
})();
