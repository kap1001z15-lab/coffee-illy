/* =========================================================================
   COFFEE ILLY — ЕДИНЫЙ МОДУЛЬ РАЗРЕШЕНИЯ И РАБОТЫ С КАМЕРОЙ (v79)
   Реализация по ТЗ: https://chatgpt.com/s/t_6af992cfec748191a5663a356f4653c7
   Поддерживаемые платформы: Android Chrome, iPhone Safari, Telegram Android, Telegram iOS
   ========================================================================= */
const CoffeeCameraPermission = (() => {
  const STORAGE_KEY = 'coffee_camera_permission_v1';
  let requestInProgress = false;
  let activeStream = null;
  let activeFacing = "environment";
  let activeFallbackCallback = null;

  const ERROR_MESSAGES = {
    denied: 'Доступ к камере запрещён. Разрешите камеру в настройках браузера или Telegram',
    not_found: 'Камера не обнаружена. Проверьте устройство или выберите фотографию из галереи',
    not_readable: 'Камера занята другим приложением. Закройте другие приложения, использующие камеру, и повторите попытку',
    security: 'Браузер не разрешает доступ к камере. Откройте Coffee Illy через защищённое HTTPS-соединение',
    constraints: 'Параметры камеры не поддерживаются устройством. Используйте загрузку фотографии',
    unsupported: 'Этот способ работы с камерой не поддерживается. Используйте загрузку фотографии',
    in_progress: 'Запрос к камере уже выполняется. Подождите пару секунд',
    no_video_track: 'Камера не передала видеопоток. Повторите попытку или используйте загрузку фотографии',
    unknown: 'Не удалось открыть камеру. Проверьте разрешения или используйте загрузку фотографии'
  };

  function getSavedState() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, state);
    } catch (error) {
      console.warn('Camera state cannot be saved', error);
    }
  }

  function isTelegram() {
    return Boolean(typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp && (window.Telegram.WebApp.initData || window.Telegram.WebApp.platform));
  }

  function detectPlatform() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isTelegram()) {
      return isIOS ? 'telegram_ios' : (isAndroid ? 'telegram_android' : 'telegram');
    }
    if (isIOS) return 'ios_safari';
    if (isAndroid) return 'android_chrome';
    return 'desktop';
  }

  function isSupported() {
    return Boolean(
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  async function checkPermission() {
    if (!isSupported()) {
      return 'unsupported';
    }
    if (!(navigator.permissions && typeof navigator.permissions.query === 'function')) {
      return 'unknown';
    }
    try {
      const result = await navigator.permissions.query({ name: 'camera' });
      return (result && result.state) ? result.state : 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  function stopStreamTracks(stream) {
    if (!stream) return;
    try {
      if (typeof stream.getTracks === 'function') {
        stream.getTracks().forEach((track) => {
          try {
            if (typeof track.applyConstraints === 'function') {
              track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
            }
          } catch (_) {}
          try { track.stop(); } catch (_) {}
        });
      }
    } catch (_) {}
    if (activeStream === stream) {
      activeStream = null;
    }
  }

  function suspendActiveStream(streamOpt) {
    const s = streamOpt || activeStream;
    if (!s) return;
    try {
      if (typeof s.getVideoTracks === 'function') {
        s.getVideoTracks().forEach((track) => {
          try {
            if (typeof track.applyConstraints === 'function') {
              track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
            }
          } catch (_) {}
          try { track.enabled = false; } catch (_) {}
        });
      }
    } catch (_) {}
  }

  function stopActiveStream() {
    if (activeStream) {
      stopStreamTracks(activeStream);
      activeStream = null;
    }
  }

  function isStreamActive() {
    if (!activeStream || typeof activeStream.getVideoTracks !== 'function') return false;
    const tracks = activeStream.getVideoTracks();
    return tracks.length > 0 && tracks.some((t) => t && t.readyState === 'live');
  }

  function mapErrorReason(error) {
    const name = (error && error.name) ? String(error.name) : '';
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        saveState('denied');
        return 'denied';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'not_found';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'not_readable';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'constraints';
      case 'SecurityError':
        return 'security';
      default:
        return 'unknown';
    }
  }

  function getErrorMessage(reasonOrError) {
    if (!reasonOrError) return ERROR_MESSAGES.unknown;
    if (typeof reasonOrError === 'string' && ERROR_MESSAGES[reasonOrError]) {
      return ERROR_MESSAGES[reasonOrError];
    }
    if (typeof reasonOrError === 'object' && reasonOrError.name) {
      const r = mapErrorReason(reasonOrError);
      return ERROR_MESSAGES[r] || ERROR_MESSAGES.unknown;
    }
    return ERROR_MESSAGES.unknown;
  }

  async function request() {
    if (requestInProgress) {
      return { ok: false, reason: 'in_progress', message: ERROR_MESSAGES.in_progress };
    }
    if (!isSupported()) {
      return { ok: false, reason: 'unsupported', message: ERROR_MESSAGES.unsupported };
    }

    requestInProgress = true;

    try {
      // ТЗ Раздел 5: Запрашивать только видеопоток, не запрашивать микрофон
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });

      const videoTracks = (stream && typeof stream.getVideoTracks === 'function') ? stream.getVideoTracks() : [];
      if (!videoTracks.length) {
        stopStreamTracks(stream);
        return { ok: false, reason: 'no_video_track', message: ERROR_MESSAGES.no_video_track };
      }

      saveState('granted');
      // Сохраняем живой видеопоток в пуле сессии (треки включены только во время съёмки, чтобы не просить разрешение повторно)
      activeStream = stream;
      activeFacing = 'environment';
      stream.getVideoTracks().forEach((t) => { try { t.enabled = false; } catch (_) {} });
      syncDeniedBannerUI('granted');

      return { ok: true, state: 'granted', message: 'Камера готова к работе' };
    } catch (error) {
      const reason = mapErrorReason(error);
      if (reason === 'denied') {
        syncDeniedBannerUI('denied');
      }
      return {
        ok: false,
        reason,
        errorName: (error && error.name) || 'Error',
        message: ERROR_MESSAGES[reason] || ERROR_MESSAGES.unknown
      };
    } finally {
      requestInProgress = false;
    }
  }

  async function acquireStream(facingOpt) {
    if (!isSupported()) {
      const err = new Error(ERROR_MESSAGES.unsupported);
      err.reason = 'unsupported';
      throw err;
    }

    const facing = facingOpt === 'user' ? 'user' : 'environment';

    // ТЗ Раздел 8: Если живой поток того же ракурса уже открыт в сессии, мгновенно переиспользуем его без повторного запроса разрешения!
    if (isStreamActive() && activeFacing === facing) {
      activeStream.getVideoTracks().forEach((t) => { try { t.enabled = true; } catch (_) {} });
      saveState('granted');
      syncDeniedBannerUI('granted');
      return activeStream;
    }
    if (isStreamActive()) {
      stopActiveStream();
    }

    const constraintsList = [
      { video: { facingMode: { ideal: facing } }, audio: false },
      { video: true, audio: false }
    ];

    let stream = null;
    let lastError = null;

    for (let i = 0; i < constraintsList.length; i++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraintsList[i]);
        if (stream) break;
      } catch (err) {
        lastError = err;
        const r = mapErrorReason(err);
        if (r === 'denied' || r === 'security') break;
      }
    }

    if (!stream) {
      const reason = mapErrorReason(lastError);
      if (reason === 'denied') syncDeniedBannerUI('denied');
      const outErr = lastError || new Error(ERROR_MESSAGES[reason]);
      outErr.reason = reason;
      outErr.userMessage = ERROR_MESSAGES[reason] || ERROR_MESSAGES.unknown;
      throw outErr;
    }

    const videoTracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
    if (!videoTracks.length) {
      stopStreamTracks(stream);
      const noTrackErr = new Error(ERROR_MESSAGES.no_video_track);
      noTrackErr.reason = 'no_video_track';
      noTrackErr.userMessage = ERROR_MESSAGES.no_video_track;
      throw noTrackErr;
    }

    activeStream = stream;
    activeFacing = facing;
    saveState('granted');
    syncDeniedBannerUI('granted');
    return stream;
  }

  async function initialize() {
    const permission = await checkPermission();
    if (permission === 'granted') {
      saveState('granted');
      return 'granted';
    }
    if (permission === 'denied') {
      saveState('denied');
      return 'denied';
    }
    return getSavedState() || 'not_requested';
  }

  function postpone() {
    if (getSavedState() !== 'granted') {
      saveState('postponed');
    }
  }

  function getRecoveryInstructions(platformOpt) {
    const p = platformOpt || detectPlatform();
    if (p === 'android_chrome') {
      return {
        title: 'Android Chrome',
        steps: [
          'Нажмите на значок настроек сайта рядом с адресной строкой браузера.',
          'Откройте раздел «Разрешения» (Permissions).',
          'Разрешите доступ к камере.',
          'Перезагрузите страницу Coffee Illy.'
        ]
      };
    }
    if (p === 'ios_safari') {
      return {
        title: 'iPhone Safari',
        steps: [
          'Откройте настройки iPhone или меню «Аа» / значок настроек сайта в адресной строке Safari.',
          'Перейдите в настройки камеры для сайта и выберите «Разрешить».',
          'Вернитесь в Coffee Illy и повторите действие.'
        ]
      };
    }
    return {
      title: 'Telegram (Android и iOS)',
      steps: [
        'Откройте системные «Настройки» телефона → «Приложения» → «Telegram».',
        'Убедитесь, что приложению Telegram разрешён доступ к камере.',
        'Закройте и повторно откройте Mini App Coffee Illy.'
      ]
    };
  }

  function syncDeniedBannerUI(stateOpt) {
    if (typeof document === 'undefined') return;
    const banner = document.getElementById('cameraDeniedBanner');
    if (!banner) return;
    const st = stateOpt || getSavedState();
    banner.hidden = st !== 'denied';
    banner.style.display = st === 'denied' ? 'flex' : 'none';
  }

  function openOnboardingModal() {
    if (typeof document === 'undefined') return;
    const dlg = document.getElementById('cameraOnboardingDlg');
    if (!dlg) return;
    try {
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', '');
        dlg.hidden = false;
      }
    } catch (_) {
      dlg.setAttribute('open', '');
      dlg.hidden = false;
    }
  }

  function closeOnboardingModal() {
    if (typeof document === 'undefined') return;
    const dlg = document.getElementById('cameraOnboardingDlg');
    if (!dlg) return;
    try {
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
    } catch (_) {}
    dlg.removeAttribute('open');
    dlg.hidden = true;
  }

  function openRecoveryModal(reasonOpt) {
    if (typeof document === 'undefined') return;
    const dlg = document.getElementById('cameraRecoveryDlg');
    if (!dlg) return;
    const msgEl = document.getElementById('cameraRecoveryErrorMsg');
    if (msgEl) {
      msgEl.textContent = getErrorMessage(reasonOpt || 'denied');
    }
    try {
      if (typeof dlg.showModal === 'function') {
        if (!dlg.open) dlg.showModal();
      } else {
        dlg.setAttribute('open', '');
        dlg.hidden = false;
      }
    } catch (_) {
      dlg.setAttribute('open', '');
      dlg.hidden = false;
    }
  }

  function closeRecoveryModal() {
    if (typeof document === 'undefined') return;
    const dlg = document.getElementById('cameraRecoveryDlg');
    if (!dlg) return;
    try {
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
    } catch (_) {}
    dlg.removeAttribute('open');
    dlg.hidden = true;
  }

  // ТЗ Раздел 11: Альтернативная загрузка фотографии через <input type="file" accept="image/*" capture="environment">
  function pickFallbackImage(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(null);
      let input = document.getElementById('cameraFallbackFileInput');
      if (!input) {
        input = document.createElement('input');
        input.id = 'cameraFallbackFileInput';
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.hidden = true;
        document.body.appendChild(input);
      }
      input.value = '';
      activeFallbackCallback = (file) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          const rawDataUrl = String(reader.result || '');
          if (!rawDataUrl || typeof Image === 'undefined') return resolve(rawDataUrl || null);
          const img = new Image();
          img.onload = () => {
            try {
              const scale = Math.min(1, 1280 / (img.width || 1280));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round((img.width || 640) * scale));
              canvas.height = Math.max(1, Math.round((img.height || 480) * scale));
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const h = Math.max(16, Math.round(canvas.width / 45));
              ctx.fillStyle = 'rgba(0,0,0,.58)';
              ctx.fillRect(0, canvas.height - h * 1.9, canvas.width, h * 1.9);
              ctx.fillStyle = '#fff';
              ctx.font = '600 ' + h + 'px system-ui,sans-serif';
              const stampText = new Date().toLocaleString('ru-RU') + (opts.stamp ? ' · ' + opts.stamp : '');
              ctx.fillText(stampText, h * 0.6, canvas.height - h * 0.6);
              resolve(canvas.toDataURL('image/jpeg', 0.78));
            } catch (_) {
              resolve(rawDataUrl);
            }
          };
          img.onerror = () => resolve(rawDataUrl);
          img.src = rawDataUrl;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.onchange = () => {
        const f = (input.files && input.files[0]) ? input.files[0] : null;
        const cb = activeFallbackCallback;
        activeFallbackCallback = null;
        if (cb) cb(f);
      };
      input.click();
    });
  }

  async function initUI() {
    if (typeof document === 'undefined') return 'unknown';
    const allowBtn = document.getElementById('btnCameraOnboardingAllow');
    const laterBtn = document.getElementById('btnCameraOnboardingLater');
    const recOpenBtn = document.getElementById('btnOpenCameraRecovery');
    const recRetryBtn = document.getElementById('btnCameraRecoveryRetry');
    const recCloseBtn = document.getElementById('btnCameraRecoveryClose');

    if (allowBtn && !allowBtn.dataset.boundCamPerm) {
      allowBtn.dataset.boundCamPerm = '1';
      allowBtn.addEventListener('click', async () => {
        allowBtn.disabled = true;
        const origText = allowBtn.textContent;
        allowBtn.textContent = 'Проверка доступа…';
        const res = await request();
        allowBtn.disabled = false;
        allowBtn.textContent = origText;
        closeOnboardingModal();
        if (res.ok) {
          if (typeof window.coffeeToast === 'function') window.coffeeToast('Камера готова к работе');
          else {
            const t = document.getElementById('toast');
            if (t) { t.textContent = 'Камера готова к работе'; t.className = 'toast show'; setTimeout(() => t.classList.remove('show'), 2600); }
          }
        } else {
          openRecoveryModal(res.reason);
        }
      });
    }

    if (laterBtn && !laterBtn.dataset.boundCamPerm) {
      laterBtn.dataset.boundCamPerm = '1';
      laterBtn.addEventListener('click', () => {
        postpone();
        closeOnboardingModal();
      });
    }

    if (recOpenBtn && !recOpenBtn.dataset.boundCamPerm) {
      recOpenBtn.dataset.boundCamPerm = '1';
      recOpenBtn.addEventListener('click', () => openRecoveryModal('denied'));
    }

    if (recRetryBtn && !recRetryBtn.dataset.boundCamPerm) {
      recRetryBtn.dataset.boundCamPerm = '1';
      recRetryBtn.addEventListener('click', async () => {
        const res = await request();
        if (res.ok) {
          closeRecoveryModal();
          const t = document.getElementById('toast');
          if (t) { t.textContent = 'Камера готова к работе'; t.className = 'toast show'; setTimeout(() => t.classList.remove('show'), 2600); }
        } else {
          const msgEl = document.getElementById('cameraRecoveryErrorMsg');
          if (msgEl) msgEl.textContent = res.message || getErrorMessage(res.reason);
        }
      });
    }

    if (recCloseBtn && !recCloseBtn.dataset.boundCamPerm) {
      recCloseBtn.dataset.boundCamPerm = '1';
      recCloseBtn.addEventListener('click', () => closeRecoveryModal());
    }

    const state = await initialize();
    syncDeniedBannerUI(state);
    // ТЗ Раздел 4 и 7: При первом открытии терминала показать собственное окно Coffee Illy (не вызывая getUserMedia автоматически)
    if (state === 'not_requested' && isSupported() && !window.COFFEE_LIVE_PREVIEW_MODE) {
      openOnboardingModal();
    } else if (state === 'granted' && isSupported() && !window.COFFEE_LIVE_PREVIEW_MODE) {
      const warmOnce = () => {
        if (!isStreamActive()) {
          acquireStream('environment').then((s) => suspendActiveStream(s)).catch(() => {});
        }
      };
      document.addEventListener('pointerdown', warmOnce, { once: true, passive: true });
    }
    return state;
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', stopActiveStream);
    window.addEventListener('beforeunload', stopActiveStream);
  }

  return {
    STORAGE_KEY,
    ERROR_MESSAGES,
    initialize,
    request,
    acquireStream,
    stopStreamTracks,
    suspendActiveStream,
    stopActiveStream,
    isStreamActive,
    checkPermission,
    isSupported,
    isTelegram,
    detectPlatform,
    getSavedState,
    saveState,
    postpone,
    getErrorMessage,
    getRecoveryInstructions,
    pickFallbackImage,
    openOnboardingModal,
    closeOnboardingModal,
    openRecoveryModal,
    closeRecoveryModal,
    initUI
  };
})();

if (typeof window !== 'undefined') {
  window.CoffeeCameraPermission = CoffeeCameraPermission;
}
