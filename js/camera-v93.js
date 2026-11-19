/* Coffee Illy v92.0 — Real Camera Capture + JPEG Compression + Google Drive Upload Helper */
(function () {
  let _stream = null;
  let _facing = 'environment';

  function stopStream() {
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

  function fileToCompressedDataUri(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try { cb(null, compressImageElement(img, 1280, 0.78)); }
        catch (err) { cb(err); }
      };
      img.onerror = () => cb(new Error('Не удалось прочитать изображение'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => cb(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  }

  function openCameraCapture(opts) {
    const title = (opts && opts.title) || 'Фото-отчёт шага';
    const preferFront = !!(opts && opts.preferFront);
    const onCaptured = (opts && opts.onCaptured) || function () {};
    _facing = preferFront ? 'user' : 'environment';

    const existing = document.getElementById('v92-cam-overlay');
    if (existing) existing.remove();

    const ov = document.createElement('div');
    ov.id = 'v92-cam-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,12,10,0.88);display:flex;align-items:center;justify-content:center;padding:14px;backdrop-filter:blur(6px)';
    ov.innerHTML =
      '<div style="width:100%;max-width:440px;background:var(--card,#26201D);color:var(--ink,#F2E7DF);border:1px solid var(--border,rgba(255,255,255,0.12));border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
          '<b style="font-size:15px">' + title.replace(/</g, '&lt;') + '</b>' +
          '<button type="button" id="v92-cam-close" style="border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:600">✕ Закрыть</button>' +
        '</div>' +
        '<div id="v92-cam-stage" style="position:relative;width:100%;aspect-ratio:4/3;background:#0d0b0a;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
          '<video id="v92-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover"></video>' +
          '<div id="v92-cam-msg" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:13px;color:#e5d9cf">Запускаем камеру…</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button type="button" id="v92-cam-snap" disabled style="flex:1;min-width:140px;padding:13px 16px;border-radius:999px;border:none;background:var(--accent,#E8B88A);color:var(--accent-ink,#2B1A0D);font-weight:700;font-size:14px;cursor:pointer">📸 Снять фото</button>' +
          '<button type="button" id="v92-cam-flip" style="padding:13px 14px;border-radius:999px;border:1px solid var(--border,rgba(255,255,255,0.15));background:var(--surface,#221D1A);color:var(--ink,#F2E7DF);font-weight:600;cursor:pointer">🔄 Камера</button>' +
        '</div>' +
        '<label style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px 14px;border-radius:999px;border:1px dashed var(--border,rgba(255,255,255,0.22));background:transparent;color:var(--muted,#B8A79A);font-size:13px;font-weight:600;cursor:pointer">' +
          '📁 Открыть системную камеру / галерею' +
          '<input type="file" id="v92-cam-file" accept="image/*" capture="environment" style="display:none">' +
        '</label>' +
      '</div>';
    document.body.appendChild(ov);

    const video = ov.querySelector('#v92-cam-video');
    const msg = ov.querySelector('#v92-cam-msg');
    const snapBtn = ov.querySelector('#v92-cam-snap');
    const flipBtn = ov.querySelector('#v92-cam-flip');
    const fileInp = ov.querySelector('#v92-cam-file');
    const closeBtn = ov.querySelector('#v92-cam-close');

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
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        msg.textContent = 'Браузер ограничил прямой доступ к камере — нажмите «Открыть системную камеру / галерею» ниже.';
        return;
      }
      try {
        _stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: _facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        });
        video.srcObject = _stream;
        await video.play();
        msg.style.display = 'none';
        snapBtn.disabled = false;
      } catch (err) {
        msg.textContent = 'Нет доступа к веб-камере (' + (err && err.name ? err.name : 'permission') + '). Используйте кнопку «Открыть системную камеру / галерею» ниже.';
      }
    }

    flipBtn.onclick = () => {
      _facing = _facing === 'environment' ? 'user' : 'environment';
      startStream();
    };

    snapBtn.onclick = () => {
      try {
        const dataUri = compressImageElement(video, 1280, 0.78);
        close();
        onCaptured(dataUri);
      } catch (err) {
        msg.style.display = 'flex';
        msg.textContent = 'Ошибка снимка: ' + (err && err.message || err);
      }
    };

    fileInp.onchange = (e) => {
      const f = e.target && e.target.files && e.target.files[0];
      if (!f) return;
      fileToCompressedDataUri(f, (err, dataUri) => {
        if (err) {
          msg.style.display = 'flex';
          msg.textContent = String(err.message || err);
          return;
        }
        close();
        onCaptured(dataUri);
      });
    };

    startStream();
  }

  window.CoffeeCameraV92 = {
    open: openCameraCapture,
    stop: stopStream
  };
})();
