/* Coffee Illy v94.0 — Strict Live Camera-Only Photo & Video Capture (Zero Gallery / File Picker) */
(function () {
  let _stream = null;
  let _recorder = null;
  let _recChunks = [];
  let _recTimer = null;
  let _facing = 'environment';

  function stopStream() {
    if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
    if (_recorder && _recorder.state !== 'inactive') {
      try { _recorder.stop(); } catch (_) {}
    }
    _recorder = null;
    if (_stream) {
      try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _stream = null;
    }
  }

  function compressVideoFrame(video, maxSide, quality) {
    const w0 = video.videoWidth || 800;
    const h0 = video.videoHeight || 600;
    const scale = Math.min(1, (maxSide || 1280) / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality || 0.78);
  }

  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function openCameraCapture(opts) {
    const title = (opts && opts.title) || 'Камера';
    const preferFront = !!(opts && opts.preferFront);
    const allowVideo = (opts && opts.allowVideo) !== false;
    const initialMode = (opts && opts.mode === 'video' && allowVideo) ? 'video' : 'photo';
    const onCaptured = (opts && opts.onCaptured) || function () {};
    _facing = preferFront ? 'user' : 'environment';
    let mode = initialMode;
    let isRecording = false;
    let recSec = 0;

    const existing = document.getElementById('v94-cam-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'v94-cam-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,12,10,0.92);display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(6px)';
    ov.innerHTML =
      '<div style="width:100%;max-width:460px;background:var(--card,#26201D);color:var(--ink,#F2E7DF);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<b style="font-size:15px">' + title.replace(/</g, '&lt;') + '</b>' +
          '<button type="button" id="v94-cam-close" style="border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:600">✕</button>' +
        '</div>' +
        (allowVideo
          ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;background:var(--surface,#221D1A);padding:4px;border-radius:999px">' +
              '<button type="button" id="v94-m-ph" style="padding:7px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer">📷 Фото</button>' +
              '<button type="button" id="v94-m-vd" style="padding:7px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer">🎥 Видео</button>' +
            '</div>'
          : '') +
        '<div id="v94-cam-stage" style="position:relative;width:100%;aspect-ratio:4/3;background:#0d0b0a;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
          '<video id="v94-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
          '<div id="v94-rec-pill" style="display:none;position:absolute;top:10px;left:10px;padding:4px 10px;border-radius:999px;background:rgba(185,28,28,0.9);color:#fff;font-size:12px;font-weight:700">● 00:00</div>' +
          '<div id="v94-cam-msg" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;font-size:13px;color:#e5d9cf">Запуск камеры…</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button type="button" id="v94-cam-act" disabled style="flex:1;padding:13px 16px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;font-size:14px;cursor:pointer">📸 Снять фото</button>' +
          '<button type="button" id="v94-cam-flip" style="padding:13px 16px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:600;cursor:pointer" title="Переключить камеру">🔄</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    const video = ov.querySelector('#v94-cam-video');
    const msg = ov.querySelector('#v94-cam-msg');
    const recPill = ov.querySelector('#v94-rec-pill');
    const actBtn = ov.querySelector('#v94-cam-act');
    const flipBtn = ov.querySelector('#v94-cam-flip');
    const closeBtn = ov.querySelector('#v94-cam-close');
    const mPh = ov.querySelector('#v94-m-ph');
    const mVd = ov.querySelector('#v94-m-vd');

    function syncModeUi() {
      if (mPh) {
        mPh.style.background = mode === 'photo' ? 'var(--accent,#E8B88A)' : 'transparent';
        mPh.style.color = mode === 'photo' ? 'var(--accent-ink,#2B1A0D)' : 'var(--muted,#B8A79A)';
      }
      if (mVd) {
        mVd.style.background = mode === 'video' ? 'var(--accent,#E8B88A)' : 'transparent';
        mVd.style.color = mode === 'video' ? 'var(--accent-ink,#2B1A0D)' : 'var(--muted,#B8A79A)';
      }
      if (isRecording) {
        actBtn.textContent = '⏹ Стоп (' + recSec + ' с)';
        actBtn.style.background = '#B33A3A';
        actBtn.style.color = '#fff';
      } else {
        actBtn.textContent = mode === 'video' ? '🔴 Начать запись' : '📸 Снять фото';
        actBtn.style.background = 'var(--accent,#E8B88A)';
        actBtn.style.color = 'var(--accent-ink,#2B1A0D)';
      }
    }

    function close() {
      isRecording = false;
      stopStream();
      ov.remove();
    }
    closeBtn.onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov && !isRecording) close(); });

    async function startStream() {
      stopStream();
      isRecording = false;
      recPill.style.display = 'none';
      msg.style.display = 'flex';
      msg.innerHTML = '<span>Запуск камеры…</span>';
      actBtn.disabled = true;
      syncModeUi();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msg.innerHTML = '<span>Камера недоступна. Откройте по HTTPS или в Telegram.</span>';
        return;
      }
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: _facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: mode === 'video'
        });
        video.srcObject = _stream;
        await video.play();
        msg.style.display = 'none';
        actBtn.disabled = false;
      } catch (_) {
        // Retry without audio if microphone permission denied in video mode
        if (mode === 'video') {
          try {
            _stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: _facing }, width: { ideal: 960 }, height: { ideal: 720 } },
              audio: false
            });
            video.srcObject = _stream;
            await video.play();
            msg.style.display = 'none';
            actBtn.disabled = false;
            return;
          } catch (__) {}
        }
        msg.innerHTML = '<span>Нет доступа к камере</span>' +
          '<button type="button" id="v94-cam-retry" style="padding:8px 16px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;cursor:pointer">Повторить</button>';
        const retryBtn = ov.querySelector('#v94-cam-retry');
        if (retryBtn) retryBtn.onclick = startStream;
      }
    }

    if (mPh) mPh.onclick = () => { if (isRecording || mode === 'photo') return; mode = 'photo'; startStream(); };
    if (mVd) mVd.onclick = () => { if (isRecording || mode === 'video') return; mode = 'video'; startStream(); };

    flipBtn.onclick = () => {
      if (isRecording) return;
      _facing = _facing === 'environment' ? 'user' : 'environment';
      startStream();
    };

    function finishRecording() {
      if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
      if (_recorder && _recorder.state !== 'inactive') {
        try { _recorder.stop(); } catch (_) {}
      }
    }

    actBtn.onclick = () => {
      if (mode === 'photo') {
        try {
          if (!video.videoWidth || !_stream) return;
          const dataUri = compressVideoFrame(video, 1280, 0.78);
          close();
          onCaptured(dataUri, 'photo');
        } catch (_) {
          msg.style.display = 'flex';
          msg.innerHTML = '<span>Не удалось сделать снимок</span>';
        }
        return;
      }
      // Video mode (camera-only via MediaRecorder)
      if (!isRecording) {
        if (typeof MediaRecorder === 'undefined' || !_stream) {
          msg.style.display = 'flex';
          msg.innerHTML = '<span>Запись видео не поддерживается этим браузером</span>';
          return;
        }
        const mime = MediaRecorder.isTypeSupported('video/mp4')
          ? 'video/mp4'
          : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm');
        _recChunks = [];
        try {
          _recorder = new MediaRecorder(_stream, { mimeType: mime, videoBitsPerSecond: 900000 });
        } catch (_) {
          _recorder = new MediaRecorder(_stream);
        }
        _recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) _recChunks.push(ev.data); };
        _recorder.onstop = async () => {
          const outMime = (_recorder && _recorder.mimeType && _recorder.mimeType.indexOf('mp4') >= 0) ? 'video/mp4' : 'video/webm';
          const blob = new Blob(_recChunks, { type: outMime });
          close();
          try {
            const dataUri = await blobToDataUri(blob);
            onCaptured(dataUri, 'video');
          } catch (_) {}
        };
        isRecording = true;
        recSec = 0;
        recPill.style.display = 'block';
        recPill.textContent = '● 00:00';
        syncModeUi();
        _recorder.start(250);
        _recTimer = setInterval(() => {
          recSec++;
          recPill.textContent = '● 00:' + String(recSec).padStart(2, '0');
          syncModeUi();
          if (recSec >= 15) finishRecording();
        }, 1000);
      } else {
        finishRecording();
      }
    };

    syncModeUi();
    startStream();
  }

  const API = { open: openCameraCapture, stop: stopStream };
  window.CoffeeCameraV94 = API;
  window.CoffeeCameraV92 = API;
})();
