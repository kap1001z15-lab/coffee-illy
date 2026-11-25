/**
 * Coffee Illy ERP & Checklist — Example Configuration (v97.19.0)
 * Скопируйте этот файл в config.js (или задайте через window.__COFFEE_ENV__ / GitHub Secrets).
 * НИКОГДА не коммитьте реальные секреты, PIN-коды или токены Telegram-бота в репозиторий.
 */
window.COFFEE_CONFIG = {
  // URL опубликованного веб-приложения Google Apps Script (/exec)
  API_URL: 'https://script.google.com/macros/s/REPLACE_WITH_YOUR_DEPLOYMENT_ID/exec',
  APP_VERSION: 'v97.19.0',
  APP_NAME: 'Coffee Illy ERP',
  SYNC_INTERVAL_MS: 3000,
  SYNC_IDLE_INTERVAL_MS: 12000,
  OFFLINE_MAX_RETRIES: 8,
  OFFLINE_BASE_DELAY_MS: 1500
};
