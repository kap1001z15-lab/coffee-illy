/* Coffee Illy v94.0 — Single-Permission Persistent Live Camera (Photo + Video up to 15s, NO Gallery) */
(function () {
  let _stream = null;
  let _facing = 'environment';
  let _hasAudio = false;
  let _audioAttempted = false;
  let _permissionGranted = false;
  let _prewarmPromise = null;
  const MAX_VIDEO_SEC = 15;

  function isStreamAlive(s) {
    if (!s) return false;
    try {
      const vt = s.getVideoTracks ? s.getVideoTracks() : [];
      return vt.length > 0 && vt.some((t) => t.readyState === 'live');
    } catch (_) {
      return false;
    }
  }

  function stopAll() {
    if (_stream) {
      try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _stream = null;
      _hasAudio = false;
      _audioAttempted = false;
    }
  }

  async function ensureStream(facing, wantAudio) {
    const targetFacing = facing || _facing || 'environment';
    if (isStreamAlive(_stream) && _facing === targetFacing && (!wantAudio || _hasAudio || _audioAttempted)) {
      return _stream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('CAMERA_UNAVAILABLE');
    }
    // Only stop old stream if switching facing or upgrading to audio
    if (_stream) {
      try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _stream = null;
    }
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: targetFacing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: !!wantAudio
      });
      _facing = targetFacing;
      _hasAudio = !!wantAudio && (_stream.getAudioTracks ? _stream.getAudioTracks().length > 0 : false);
      _audioAttempted = !!wantAudio;
      _permissionGranted = true;
      return _stream;
    } catch (err) {
      if (wantAudio) {
        // Fallback to video-only if microphone permission is denied
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: targetFacing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        });
        _facing = targetFacing;
        _hasAudio = false;
        _audioAttempted = true;
        _permissionGranted = true;
        return _stream;
      }
      throw err;
    }
  }

  // Called ONCE after login to acquire camera permission once for the entire shift
  function prewarm() {
    if (_permissionGranted && isStreamAlive(_stream)) return Promise.resolve(true);
    if (_prewarmPromise) return _prewarmPromise;
    _prewarmPromise = ensureStream('environment', true)
      .then(() => true)
      .catch(() => false)
      .finally(() => { _prewarmPromise = null; });
    return _prewarmPromise;
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

  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const candidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (let i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (_) {}
    }
    return '';
  }

  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('READ_FAILED'));
      fr.readAsDataURL(blob);
    });
  }

  function openCameraCapture(opts) {
    const title = (opts && opts.title) || 'Камера';
    const preferFront = !!(opts && opts.preferFront);
    const onCaptured = (opts && opts.onCaptured) || function () {};
    const targetFacing = preferFront ? 'user' : 'environment';

    const existing = document.getElementById('v94-cam-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'v94-cam-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(12,10,8,0.92);display:flex;align-items:center;justify-content:center;padding:12px;backdrop-filter:blur(8px)';
    ov.innerHTML =
      '<div style="width:100%;max-width:440px;background:var(--card,#26201D);color:var(--ink,#F2E7DF);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:26px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<b style="font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + String(title).replace(/</g, '&lt;') + '</b>' +
          '<button type="button" id="v94-cam-close" style="border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:700">✕</button>' +
        '</div>' +
        '<div style="position:relative;width:100%;aspect-ratio:4/3;background:#0d0b0a;border-radius:18px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
          '<video id="v94-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
          '<div id="v94-rec-pill" style="display:none;position:absolute;top:10px;left:10px;background:rgba(179,58,58,0.92);color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:750;font-variant-numeric:tabular-nums">● REC 00:00 / 00:15</div>' +
          '<div id="v94-cam-msg" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;font-size:13px;color:#e5d9cf">Подключение камеры…</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button type="button" id="v94-cam-photo" disabled style="flex:1;padding:12px 10px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:750;font-size:13.5px;cursor:pointer">📷 Фото</button>' +
          '<button type="button" id="v94-cam-video-btn" disabled style="flex:1;padding:12px 10px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:750;font-size:13.5px;cursor:pointer">🎬 Видео (15с)</button>' +
          '<button type="button" id="v94-cam-flip" style="padding:12px 14px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:700;cursor:pointer" title="Переключить камеру">🔄</button>' +
        '</div>' +
        '<div style="text-align:center;font-size:11.5px;color:var(--muted,#B8A79A)">Только живая съёмка · загрузка из галереи отключена</div>' +
      '</div>';
    document.body.appendChild(ov);

    const video = ov.querySelector('#v94-cam-video');
    const msg = ov.querySelector('#v94-cam-msg');
    const recPill = ov.querySelector('#v94-rec-pill');
    const photoBtn = ov.querySelector('#v94-cam-photo');
    const videoBtn = ov.querySelector('#v94-cam-video-btn');
    const flipBtn = ov.querySelector('#v94-cam-flip');
    const closeBtn = ov.querySelector('#v94-cam-close');

    let recorder = null;
    let recChunks = [];
    let recTimer = null;
    let recSec = 0;
    let isRecording = false;
    let curFacing = targetFacing;

    function clearRecTimer() {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
    }

    // IMPORTANT: Keep _stream warm on close so browser/WebView NEVER re-prompts permission!
    function closeOverlay() {
      clearRecTimer();
      if (isRecording && recorder && recorder.state !== 'inactive') {
        try { recorder.onstop = null; recorder.stop(); } catch (_) {}
      }
      isRecording = false;
      try { video.srcObject = null; } catch (_) {}
      ov.remove();
    }

    closeBtn.onclick = closeOverlay;
    ov.addEventListener('click', (e) => { if (e.target === ov && !isRecording) closeOverlay(); });

    async function attachStream(facing) {
      msg.style.display = 'flex';
      msg.innerHTML = '<span>Подключение камеры…</span>';
      photoBtn.disabled = true;
      videoBtn.disabled = true;
      try {
        const s = await ensureStream(facing, true);
        video.srcObject = s;
        await video.play();
        msg.style.display = 'none';
        photoBtn.disabled = false;
        videoBtn.disabled = typeof MediaRecorder === 'undefined';
      } catch (_) {
        msg.innerHTML = '<span>Разрешите доступ к камере один раз для работы в смене.</span>' +
          '<button type="button" id="v94-cam-retry" style="padding:8px 16px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;cursor:pointer">Разрешить</button>';
        const retryBtn = ov.querySelector('#v94-cam-retry');
        if (retryBtn) retryBtn.onclick = () => attachStream(curFacing);
      }
    }

    flipBtn.onclick = () => {
      if (isRecording) return;
      curFacing = curFacing === 'environment' ? 'user' : 'environment';
      attachStream(curFacing);
    };

    photoBtn.onclick = () => {
      if (isRecording) return;
      try {
        if (!video.videoWidth || !_stream) return;
        const dataUri = compressVideoFrame(video, 1280, 0.78);
        closeOverlay();
        onCaptured(dataUri, { mediaType: 'image' });
      } catch (_) {
        msg.style.display = 'flex';
        msg.innerHTML = '<span>Не удалось сделать снимок</span>';
      }
    };

    function stopRecording() {
      clearRecTimer();
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (_) {}
      }
    }

    videoBtn.onclick = () => {
      if (isRecording) {
        stopRecording();
        return;
      }
      if (!_stream || typeof MediaRecorder === 'undefined') return;
      try {
        recChunks = [];
        recSec = 0;
        const mime = pickRecorderMime();
        const recOpts = mime ? { mimeType: mime, videoBitsPerSecond: 900000 } : { videoBitsPerSecond: 900000 };
        recorder = new MediaRecorder(_stream, recOpts);
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) recChunks.push(ev.data);
        };
        recorder.onstop = async () => {
          clearRecTimer();
          isRecording = false;
          const dur = Math.max(1, recSec);
          const finalMime = (recorder && recorder.mimeType) || mime || 'video/webm';
          const blob = new Blob(recChunks, { type: finalMime });
          closeOverlay();
          try {
            const dataUri = await blobToDataUri(blob);
            onCaptured(dataUri, { mediaType: 'video', durationSec: dur });
          } catch (_) {}
        };
        recorder.start(250);
        isRecording = true;
        photoBtn.disabled = true;
        flipBtn.disabled = true;
        videoBtn.style.background = 'var(--bad,#B33A3A)';
        videoBtn.style.color = '#fff';
        videoBtn.textContent = '⏹ Стоп';
        recPill.style.display = 'block';
        recPill.textContent = '● REC 00:00 / 00:15';
        recTimer = setInterval(() => {
          recSec++;
          const ss = String(recSec).padStart(2, '0');
          recPill.textContent = '● REC 00:' + ss + ' / 00:' + String(MAX_VIDEO_SEC).padStart(2, '0');
          if (recSec >= MAX_VIDEO_SEC) stopRecording();
        }, 1000);
      } catch (_) {
        isRecording = false;
        photoBtn.disabled = false;
        flipBtn.disabled = false;
        msg.style.display = 'flex';
        msg.innerHTML = '<span>Запись видео не поддерживается в этом браузере</span>';
      }
    };

    attachStream(curFacing);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', stopAll);
  }

  const CAM_API = {
    open: openCameraCapture,
    prewarm: prewarm,
    stop: stopAll,
    isReady: function () { return _permissionGranted && isStreamAlive(_stream); },
    MAX_VIDEO_SEC: MAX_VIDEO_SEC
  };
  window.CoffeeCameraV94 = CAM_API;
  window.CoffeeCameraV92 = CAM_API;
})();
