/* Coffee Illy v94.0 — Strict Live-Only Camera (No Gallery) + Photo + 15s Video + Front/Rear + One-Time Persistent Permission */
(function () {
  const MAX_VIDEO_SEC = 15;
  let _stream = null;
  let _facing = 'environment';
  let _primed = false;
  let _recorder = null;
  let _recChunks = [];
  let _recTimer = null;
  let _recStartTs = 0;

  function isStreamAlive() {
    return !!(_stream && _stream.getVideoTracks && _stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  function setTracksEnabled(enabled) {
    if (!_stream || !_stream.getTracks) return;
    _stream.getTracks().forEach((t) => {
      try { t.enabled = !!enabled; } catch (_) {}
    });
  }

  function releaseStream() {
    stopRecordingInternal(true);
    if (_stream) {
      try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _stream = null;
    }
    _primed = false;
  }

  function stopRecordingInternal(discard) {
    if (_recTimer) {
      clearInterval(_recTimer);
      _recTimer = null;
    }
    if (_recorder && _recorder.state !== 'inactive') {
      try {
        if (discard) _recorder.onstop = null;
        _recorder.stop();
      } catch (_) {}
    }
    if (discard) {
      _recorder = null;
      _recChunks = [];
    }
  }

  async function ensureLiveStream(facingMode) {
    const targetFacing = facingMode || _facing || 'environment';
    if (isStreamAlive() && _facing === targetFacing) {
      setTracksEnabled(true);
      return _stream;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Камера недоступна в этом браузере. Откройте приложение через Telegram или Chrome.');
    }
    releaseStream();
    _facing = targetFacing;
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: _facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
    } catch (_) {
      // Fallback without strict facingMode constraint (e.g. desktop webcam)
      _stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    _primed = true;
    return _stream;
  }

  async function primePermission(preferFront) {
    if (isStreamAlive()) return true;
    try {
      await ensureLiveStream(preferFront ? 'user' : 'environment');
      setTracksEnabled(false); // Keep permission & stream warm without draining battery until modal opens
      return true;
    } catch (_) {
      return false;
    }
  }

  function compressImageElement(videoEl, maxSide, quality) {
    const w0 = videoEl.videoWidth || videoEl.width || 800;
    const h0 = videoEl.videoHeight || videoEl.height || 600;
    const scale = Math.min(1, (maxSide || 1280) / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality || 0.78);
  }

  function pickVideoMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    const candidates = [
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
    for (let i = 0; i < candidates.length; i++) {
      try { if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i]; } catch (_) {}
    }
    return '';
  }

  function openCameraCapture(opts) {
    const title = (opts && opts.title) || 'Живая камера (фото / видео до 15с)';
    const preferFront = !!(opts && opts.preferFront);
    const onCaptured = (opts && opts.onCaptured) || function () {};
    const targetFacing = preferFront ? 'user' : 'environment';

    const existing = document.getElementById('v94-cam-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'v94-cam-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,12,10,0.92);display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(6px)';
    ov.innerHTML =
      '<div style="width:100%;max-width:440px;background:var(--card,#26201D);color:var(--ink,#F2E7DF);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<b style="font-size:15px">' + String(title).replace(/</g, '&lt;') + '</b>' +
          '<button type="button" id="v94-cam-close" style="border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:600">✕ Закрыть</button>' +
        '</div>' +
        '<div id="v94-cam-stage" style="position:relative;width:100%;aspect-ratio:4/3;background:#0d0b0a;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
          '<video id="v94-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
          '<div id="v94-rec-badge" style="display:none;position:absolute;top:10px;left:10px;background:rgba(210,45,45,0.92);color:#fff;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.3px">🔴 REC 0:00 / 0:15</div>' +
          '<div id="v94-lens-badge" style="position:absolute;top:10px;right:10px;background:rgba(20,16,14,0.72);color:#f2e7df;padding:4px 9px;border-radius:999px;font-size:11.5px;font-weight:600">Основная</div>' +
          '<div id="v94-cam-msg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:13px;color:#e5d9cf">Запускаем живую камеру…</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" id="v94-cam-snap" disabled style="flex:1;min-width:120px;padding:13px 14px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;font-size:14px;cursor:pointer">📸 Фото</button>' +
          '<button type="button" id="v94-cam-rec" disabled style="flex:1;min-width:130px;padding:13px 14px;border-radius:999px;border:1px solid rgba(229,115,115,0.45);background:rgba(229,115,115,0.16);color:#ffb4ab;font-weight:700;font-size:14px;cursor:pointer">🎬 Видео (15с)</button>' +
          '<button type="button" id="v94-cam-flip" style="padding:13px 14px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:600;cursor:pointer" title="Переключить основную / фронтальную камеру">🔄</button>' +
        '</div>' +
        '<div style="text-align:center;font-size:11.5px;color:var(--muted,#B8A79A)">🔒 Только живая съёмка сейчас · Загрузка из галереи отключена</div>' +
      '</div>';
    document.body.appendChild(ov);

    const video = ov.querySelector('#v94-cam-video');
    const msg = ov.querySelector('#v94-cam-msg');
    const recBadge = ov.querySelector('#v94-rec-badge');
    const lensBadge = ov.querySelector('#v94-lens-badge');
    const snapBtn = ov.querySelector('#v94-cam-snap');
    const recBtn = ov.querySelector('#v94-cam-rec');
    const flipBtn = ov.querySelector('#v94-cam-flip');
    const closeBtn = ov.querySelector('#v94-cam-close');

    function closeKeepWarm() {
      stopRecordingInternal(true);
      try { video.srcObject = null; } catch (_) {}
      setTracksEnabled(false); // Keep permission granted so next step opens instantly without re-asking
      ov.remove();
    }
    closeBtn.onclick = closeKeepWarm;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeKeepWarm(); });

    function updateLensUi() {
      const isFront = _facing === 'user';
      lensBadge.textContent = isFront ? 'Фронтальная' : 'Основная';
      video.style.transform = isFront ? 'scaleX(-1)' : 'none';
    }

    async function attachStream(facing) {
      msg.style.display = 'flex';
      msg.textContent = 'Запускаем живую камеру…';
      snapBtn.disabled = true;
      recBtn.disabled = true;
      try {
        const st = await ensureLiveStream(facing);
        video.srcObject = st;
        await video.play();
        updateLensUi();
        msg.style.display = 'none';
        snapBtn.disabled = false;
        recBtn.disabled = (typeof MediaRecorder === 'undefined');
      } catch (err) {
        msg.textContent = 'Разрешите доступ к камере в настройках Telegram/браузера (' + (err && err.message ? err.message : 'permission') + '). Загрузка из галереи запрещена.';
      }
    }

    flipBtn.onclick = () => {
      if (_recorder && _recorder.state === 'recording') return;
      const nextFacing = _facing === 'environment' ? 'user' : 'environment';
      attachStream(nextFacing);
    };

    snapBtn.onclick = () => {
      if (_recorder && _recorder.state === 'recording') return;
      try {
        const dataUri = compressImageElement(video, 1280, 0.78);
        closeKeepWarm();
        onCaptured(dataUri, { mediaType: 'image', mimeType: 'image/jpeg', facing: _facing });
      } catch (err) {
        msg.style.display = 'flex';
        msg.textContent = 'Ошибка снимка: ' + (err && err.message || err);
      }
    };

    function finishVideoRecording() {
      if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
      if (_recorder && _recorder.state === 'recording') {
        try { _recorder.stop(); } catch (_) {}
      }
    }

    recBtn.onclick = () => {
      if (_recorder && _recorder.state === 'recording') {
        finishVideoRecording();
        return;
      }
      if (!isStreamAlive() || typeof MediaRecorder === 'undefined') return;
      try {
        _recChunks = [];
        const mime = pickVideoMimeType();
        const recOpts = mime ? { mimeType: mime, videoBitsPerSecond: 650000 } : { videoBitsPerSecond: 650000 };
        _recorder = new MediaRecorder(_stream, recOpts);
        _recorder.ondataavailable = (ev) => {
          if (ev && ev.data && ev.data.size > 0) _recChunks.push(ev.data);
        };
        _recorder.onstop = () => {
          const durSec = Math.min(MAX_VIDEO_SEC, Math.max(1, Math.round((Date.now() - _recStartTs) / 1000)));
          const finalMime = (mime || (_recorder && _recorder.mimeType) || 'video/webm').split(';')[0];
          const blob = new Blob(_recChunks, { type: finalMime });
          _recChunks = [];
          _recorder = null;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUri = String(reader.result || '');
            closeKeepWarm();
            onCaptured(dataUri, { mediaType: 'video', mimeType: finalMime, durationSec: durSec, facing: _facing });
          };
          reader.readAsDataURL(blob);
        };
        _recStartTs = Date.now();
        _recorder.start(250);
        snapBtn.disabled = true;
        flipBtn.disabled = true;
        recBadge.style.display = 'block';
        recBadge.textContent = '🔴 REC 0:00 / 0:15';
        recBtn.textContent = '⏹ Стоп';
        recBtn.style.background = '#d32f2f';
        recBtn.style.color = '#fff';
        _recTimer = setInterval(() => {
          const sec = Math.floor((Date.now() - _recStartTs) / 1000);
          const clamped = Math.min(MAX_VIDEO_SEC, sec);
          recBadge.textContent = '🔴 REC 0:' + String(clamped).padStart(2, '0') + ' / 0:' + String(MAX_VIDEO_SEC).padStart(2, '0');
          if (Date.now() - _recStartTs >= MAX_VIDEO_SEC * 1000) {
            finishVideoRecording();
          }
        }, 200);
      } catch (err) {
        msg.style.display = 'flex';
        msg.textContent = 'Не удалось начать запись видео: ' + (err && err.message || err);
      }
    };

    attachStream(targetFacing);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', releaseStream);
  }

  const CAM_API = {
    MAX_VIDEO_SEC: MAX_VIDEO_SEC,
    open: openCameraCapture,
    primePermission: primePermission,
    release: releaseStream,
    stop: releaseStream,
    isPrimed: function () { return _primed && isStreamAlive(); }
  };
  window.CoffeeCameraV94 = CAM_API;
  window.CoffeeCameraV92 = CAM_API;
})();
