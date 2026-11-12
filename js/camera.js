/* =========================================================================
   КАМЕРА (только живая съёмка): фото, видео, фронтальная / основная камера.
   Никакого выбора из галереи и файлов — снимок можно сделать только здесь.
   Использование:
     window.coffeeCamera.open({ mode: 'photo' | 'video', facing: 'environment' | 'user', stamp: 'Кофейня · Настя' })
       .then((dataUrl) => { if (dataUrl) ... });   // null — если отменили / камеры нет
   ========================================================================= */
(function () {
  'use strict';
  const VID_MAX = 15; // секунд
  let busy = false;

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
      const top = mk('div', 'position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 12px) 14px 12px;background:linear-gradient(#000a,#0000)');
      const bClose = mk('button', 'border:0;border-radius:999px;background:#0008;color:#fff;font-size:18px;font-weight:700;padding:10px 16px;cursor:pointer', '✕ Отмена');
      const bFlip = mk('button', 'border:0;border-radius:999px;background:#0008;color:#fff;font-size:15px;font-weight:700;padding:10px 16px;cursor:pointer');
      bClose.type = bFlip.type = 'button';
      top.append(bClose, bFlip);
      const info = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 66px);left:0;right:0;text-align:center;font-size:14px;font-weight:600;text-shadow:0 1px 4px #000;padding:0 16px');
      const rect = mk('div', 'position:absolute;top:calc(env(safe-area-inset-top,0px) + 66px);left:50%;transform:translateX(-50%);display:none;background:#d32f2f;border-radius:999px;padding:4px 14px;font-weight:700;font-size:15px');
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
      // <dialog> в верхнем слое: камера всегда поверх любых окон (в т.ч. формы поломки)
      try { if (typeof ov.showModal === 'function') ov.showModal(); else ov.setAttribute('open', ''); } catch (_) { ov.setAttribute('open', ''); }
      ov.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      const onHide = () => { if (document.hidden) finish(null); };   // приложение свернули — закрываем камеру
      document.addEventListener('visibilitychange', onHide);

      function paintModes() {
        const on = 'border:0;border-radius:999px;padding:8px 16px;font-weight:700;font-size:14px;cursor:pointer;background:#fff;color:#000';
        const off = 'border:0;border-radius:999px;padding:8px 16px;font-weight:700;font-size:14px;cursor:pointer;background:#0008;color:#fff';
        mPhoto.style.cssText = mode === 'photo' ? on : off;
        mVideo.style.cssText = mode === 'video' ? on : off;
        shutter.style.background = mode === 'video' ? '#d32f2f' : '#fff3';
        bFlip.textContent = facing === 'user' ? '🔄 Основная камера' : '🤳 Фронтальная';
      }
      function say(t, bad) { info.textContent = t || ''; info.style.color = bad ? '#ff8a80' : '#fff'; }

      function stopStream() {
        if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
        stream = null; video.srcObject = null;
      }
      function finish(result) {
        if (closed) return; closed = true;
        clearInterval(recTimer);
        if (rec && rec.state === 'recording') { rec.onstop = null; try { rec.stop(); } catch (_) {} }
        stopStream();
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
        stopStream(); shutter.disabled = true;
        const tries = [
          { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false }
        ];
        let s = null, err;
        for (const c of tries) {
          try { s = await navigator.mediaDevices.getUserMedia(c); break; }
          catch (e) { err = e; if (e && /NotAllowed|Permission|Security/i.test(e.name)) break; }
        }
        if (!s) throw err || new Error('no camera');
        if (closed) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s; video.srcObject = s;
        video.style.transform = facing === 'user' ? 'scaleX(-1)' : '';
        try { await video.play(); } catch (_) {}
        await new Promise((r) => { if (video.videoWidth) return r(); video.onloadedmetadata = () => r(); setTimeout(r, 2500); });
        await new Promise((r) => setTimeout(r, 250));
        shutter.disabled = !video.videoWidth;
      }
      function camError(e) {
        const n = (e && e.name) || '';
        say(/NotAllowed|Permission|Security/i.test(n)
          ? 'Нет доступа к камере. Разрешите камеру в настройках браузера и повторите.'
          : 'Камера недоступна на этом устройстве. Выбрать снимок из галереи нельзя.', true);
      }

      function stampText() {
        return new Date().toLocaleString('ru-RU') + (opts.stamp ? ' · ' + opts.stamp : '');
      }
      function takePhoto(n) {
        if (!video.videoWidth) return;
        const k = Math.min(1, 1280 / video.videoWidth), c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        if (isBlack(c) && n < 3) return void setTimeout(() => takePhoto(n + 1), 350);
        const x = c.getContext('2d'), h = Math.max(16, Math.round(c.width / 45));
        x.fillStyle = 'rgba(0,0,0,.58)'; x.fillRect(0, c.height - h * 1.9, c.width, h * 1.9);
        x.fillStyle = '#fff'; x.font = '600 ' + h + 'px system-ui,sans-serif';
        x.fillText(stampText(), h * 0.6, c.height - h * 0.6);
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
      mPhoto.onclick = () => { mode = 'photo'; paintModes(); say('Наведите камеру и нажмите на кнопку'); };
      mVideo.onclick = () => { mode = 'video'; paintModes(); say('Видео до ' + VID_MAX + ' секунд'); };
      shutter.onclick = () => { if (mode === 'video') toggleRec(); else takePhoto(0); };
      bFlip.onclick = async () => {
        if (rec && rec.state === 'recording') return;
        const prev = facing; facing = prev === 'user' ? 'environment' : 'user'; paintModes();
        try { await startStream(); }
        catch (e) {
          facing = prev; paintModes();
          try { await startStream(); say('Вторая камера недоступна', true); } catch (x) { camError(x); }
        }
      };

      paintModes();
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
        say('Камера недоступна (нужно открыть приложение по https). Выбрать снимок из галереи нельзя.', true);
        return;
      }
      say('Запускаем камеру…');
      startStream().then(() => { if (!closed) say(mode === 'video' ? 'Видео до ' + VID_MAX + ' секунд' : 'Наведите камеру и нажмите на кнопку'); })
        .catch((e) => { if (!closed) camError(e); });
    });
  }

  window.coffeeCamera = { open };
})();
