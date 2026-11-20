/* Coffee Illy v94.0 — Real Camera Capture (Multi-Photo + Video Recording + Multi-File Gallery) */
(function () {
  let _stream = null;
  let _recorder = null;
  let _chunks = [];
  let _facing = 'environment';

  function stopStream() {
    if (_recorder && _recorder.state !== 'inactive') {
      try { _recorder.stop(); } catch (_) {}
    }
    _recorder = null;
    if (_stream) {
      try { _stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _stream = null;
    }
  }

  function compressImageElement(imgOrVideo, maxSide, quality) {
    const w0 = imgOrVideo.videoWidth || imgOrVideo.naturalWidth || imgOrVideo.width || 800;
    const h0 = imgOrVideo.videoHeight || imgOrVideo.naturalHeight || imgOrVideo.height || 600;
    const scale = Math.min(1, (maxSide || 1280) / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.drawImage(imgOrVideo, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality || 0.78);
  }

  function fileToDataUri(file, cb) {
    if (/^video\//i.test(file.type || '')) {
      if (file.size > 11.5 * 1024 * 1024) {
        cb(new Error('Видео больше 11.5 МБ — снимите ролик покороче (до 15–20 сек)'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => cb(null, String(reader.result || ''), 'video');
      reader.onerror = () => cb(new Error('Ошибка чтения видеофайла'));
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try { cb(null, compressImageElement(img, 1280, 0.78), 'image'); }
        catch (err) { cb(err); }
      };
      img.onerror = () => cb(new Error('Не удалось прочитать изображение'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => cb(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  }

  function openCameraCapture(opts) {
    const title = (opts && opts.title) || 'Фото / видео отчёт';
    const preferFront = !!(opts && opts.preferFront);
    const onCaptured = (opts && opts.onCaptured) || function () {};
    _facing = preferFront ? 'user' : 'environment';

    const existing = document.getElementById('v94-cam-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'v94-cam-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,12,10,0.9);display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(6px)';
    ov.innerHTML =
      '<div style="width:100%;max-width:440px;background:var(--card,#26201D);color:var(--ink,#F2E7DF);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<b style="font-size:15px">' + String(title).replace(/</g, '&lt;') + '</b>' +
          '<button type="button" id="v94-cam-close" style="border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:600">✕ Готово</button>' +
        '</div>' +
        '<div id="v94-cam-stage" style="position:relative;width:100%;aspect-ratio:4/3;background:#0d0b0a;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
          '<video id="v94-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
          '<div id="v94-cam-rec-ind" style="display:none;position:absolute;top:10px;left:10px;background:#e05252;color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700">● REC</div>' +
          '<div id="v94-cam-msg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:13px;color:#e5d9cf">Запускаем камеру…</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" id="v94-cam-snap" disabled style="flex:1;min-width:120px;padding:12px 14px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;font-size:13.5px;cursor:pointer">📸 Фото</button>' +
          '<button type="button" id="v94-cam-rec" disabled style="flex:1;min-width:120px;padding:12px 14px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.18));background:var(--bad-soft,rgba(224,82,82,0.18));color:var(--bad,#ff8a8a);font-weight:700;font-size:13.5px;cursor:pointer">🎥 Видео</button>' +
          '<button type="button" id="v94-cam-flip" style="padding:12px 14px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:600;cursor:pointer">🔄</button>' +
        '</div>' +
        '<label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 14px;border-radius:999px;border:1px dashed var(--border,rgba(255,255,255,0.22));background:transparent;color:var(--muted,#B8A79A);font-size:13px;font-weight:600;cursor:pointer">' +
          '📁 Выбрать несколько фото / видео из галереи' +
          '<input type="file" id="v94-cam-file" accept="image/*,video/*" multiple style="display:none">' +
        '</label>' +
      '</div>';
    document.body.appendChild(ov);

    const video = ov.querySelector('#v94-cam-video');
    const msg = ov.querySelector('#v94-cam-msg');
    const recInd = ov.querySelector('#v94-cam-rec-ind');
    const snapBtn = ov.querySelector('#v94-cam-snap');
    const recBtn = ov.querySelector('#v94-cam-rec');
    const flipBtn = ov.querySelector('#v94-cam-flip');
    const fileInp = ov.querySelector('#v94-cam-file');
    const closeBtn = ov.querySelector('#v94-cam-close');

    function close() {
      stopStream();
      ov.remove();
    }
    closeBtn.onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

    async function startStream() {
      stopStream();
      msg.style.display = 'flex';
      msg.textContent = 'Запускаем камеру…';
      snapBtn.disabled = true;
      recBtn.disabled = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msg.textContent = 'Нажмите «Выбрать несколько фото / видео из галереи» ниже.';
        return;
      }
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: _facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: true
        }).catch(() => navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: _facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        }));
        video.srcObject = _stream;
        await video.play();
        msg.style.display = 'none';
        snapBtn.disabled = false;
        recBtn.disabled = (typeof MediaRecorder === 'undefined');
      } catch (err) {
        msg.textContent = 'Нет доступа к веб-камере. Используйте кнопку выбора фото/видео из галереи ниже.';
      }
    }

    flipBtn.onclick = () => {
      _facing = _facing === 'environment' ? 'user' : 'environment';
      startStream();
    };

    snapBtn.onclick = () => {
      try {
        const dataUri = compressImageElement(video, 1280, 0.78);
        onCaptured(dataUri, 'image');
        msg.style.display = 'flex';
        msg.textContent = '✓ Фото добавлено! Можно снять ещё или нажать «✕ Готово»';
        setTimeout(() => { if (_stream) msg.style.display = 'none'; }, 1100);
      } catch (err) {
        msg.style.display = 'flex';
        msg.textContent = 'Ошибка снимка: ' + (err && err.message || err);
      }
    };

    recBtn.onclick = () => {
      if (!_stream || typeof MediaRecorder === 'undefined') return;
      if (_recorder && _recorder.state === 'recording') {
        _recorder.stop();
        return;
      }
      _chunks = [];
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm' : (MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm');
      try {
        _recorder = new MediaRecorder(_stream, { mimeType: mime, videoBitsPerSecond: 900000 });
      } catch (_) {
        _recorder = new MediaRecorder(_stream);
      }
      _recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) _chunks.push(ev.data); };
      _recorder.onstop = () => {
        recInd.style.display = 'none';
        recBtn.textContent = '🎥 Видео';
        const blob = new Blob(_chunks, { type: _recorder.mimeType || 'video/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          onCaptured(String(reader.result || ''), 'video');
          close();
        };
        reader.readAsDataURL(blob);
      };
      _recorder.start();
      recInd.style.display = 'block';
      recBtn.textContent = '⏹ Стоп';
      setTimeout(() => { if (_recorder && _recorder.state === 'recording') _recorder.stop(); }, 20000);
    };

    fileInp.onchange = (e) => {
      const files = Array.from((e.target && e.target.files) || []);
      if (!files.length) return;
      let done = 0;
      files.forEach((f) => {
        fileToDataUri(f, (err, dataUri, mType) => {
          done++;
          if (!err && dataUri) onCaptured(dataUri, mType);
          else if (err) { msg.style.display = 'flex'; msg.textContent = String(err.message || err); }
          if (done >= files.length && !err) close();
        });
      });
    };

    startStream();
  }

  const CAM_API = { open: openCameraCapture, stop: stopStream };
  window.CoffeeCameraV94 = CAM_API;
  window.CoffeeCameraV92 = CAM_API;
})();
