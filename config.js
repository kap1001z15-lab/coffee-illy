/**
 * Coffee Illy ERP & Checklist — Runtime Configuration (v98.5.0)
 * Приоритет определения API_URL:
 * 1. window.__COFFEE_ENV__.API_URL (подставляется CI/CD из GitHub Secrets при сборке)
 * 2. localStorage.getItem('coffee_illy_api_url_override') (ручная настройка на устройстве)
 * 3. Значение по умолчанию из этого файла (замените на ваш опубликованный GAS /exec URL)
 */
(function () {
  var env = (typeof window !== 'undefined' && window.__COFFEE_ENV__) || {};
  var overrideUrl = '';
  try {
    overrideUrl = localStorage.getItem('coffee_illy_api_url_override') || '';
  } catch (_) {}

  var defaultApiUrl = 'https://script.google.com/macros/s/AKfycbwCPF5mFQtEXyoDmypOG-2YQbhuNruLwDkV3s0DobMdQFBAA6sTRaJIOna9UY5Ow-m5Tw/exec';
  var resolvedUrl = String(env.API_URL || overrideUrl || defaultApiUrl).trim();

  window.COFFEE_CONFIG = {
    API_URL: resolvedUrl,
    APP_VERSION: 'v98.5.0',
    APP_NAME: 'Coffee Illy ERP',
    SYNC_INTERVAL_MS: Number(env.SYNC_INTERVAL_MS) || 3500,
    SYNC_ACTIVE_MS: Number(env.SYNC_ACTIVE_MS) || 2500,
    SYNC_WARM_MS: Number(env.SYNC_WARM_MS) || 5000,
    SYNC_IDLE_MS: Number(env.SYNC_IDLE_MS) || 12000,
    SYNC_IDLE_INTERVAL_MS: Number(env.SYNC_IDLE_INTERVAL_MS) || 20000,
    OFFLINE_MAX_RETRIES: Number(env.OFFLINE_MAX_RETRIES) || 8,
    OFFLINE_BASE_DELAY_MS: Number(env.OFFLINE_BASE_DELAY_MS) || 1500
  };
})();
