/* =========================================================================
   COFFEE ILLY v4.4 — УПРАВЛЕНИЕ ТЕМОЙ (Auto / Light / Dark)
   Подключается в <head> до основного CSS для предотвращения вспышки темы.
   Оформление и геометрия 100% одинаковы во всех темах; меняются только цвета.
   ========================================================================= */
(function (g) {
  var STORAGE_KEY = 'coffee_illy_theme_v4';
  var LEGACY_KEY = 'coffee_illy_theme';
  var VALID_MODES = { auto: true, light: true, dark: true };
  var LABELS = { auto: '🌓 Авто', light: '☀️ Светлая', dark: '🌙 Тёмная' };
  var TITLES = {
    auto: 'Тема: Авто (как на устройстве)',
    light: 'Тема: Светлая',
    dark: 'Тема: Тёмная'
  };

  function getSavedMode() {
    try {
      var v = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY) || 'auto';
      return VALID_MODES[v] ? v : 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function getSystemDark() {
    try {
      var tgScheme = g.Telegram && g.Telegram.WebApp && g.Telegram.WebApp.colorScheme;
      if (tgScheme === 'dark') return true;
      if (tgScheme === 'light') return false;
      return !!(g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) {
      return false;
    }
  }

  function resolveEffectiveTheme(mode) {
    var m = VALID_MODES[mode] ? mode : getSavedMode();
    if (m === 'auto') return getSystemDark() ? 'dark' : 'light';
    return m;
  }

  function syncThemeButtons(mode) {
    if (typeof document === 'undefined') return;
    var btns = document.querySelectorAll('.theme-btn#theme, #themeToggleBtn, [data-theme-cycle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!b) continue;
      b.textContent = LABELS[mode] || LABELS.auto;
      b.setAttribute('title', TITLES[mode] || TITLES.auto);
      b.setAttribute('aria-label', TITLES[mode] || TITLES.auto);
    }
  }

  function applyTheme(modeOpt) {
    var mode = VALID_MODES[modeOpt] ? modeOpt : getSavedMode();
    var effective = resolveEffectiveTheme(mode);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', effective);
      document.documentElement.setAttribute('data-theme-mode', mode);
    }
    try {
      var meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null;
      var bgHex = effective === 'dark' ? '#171311' : '#FCF8F4';
      if (meta) meta.setAttribute('content', bgHex);
      var tgApp = g.Telegram && g.Telegram.WebApp;
      if (tgApp && typeof tgApp.setHeaderColor === 'function') tgApp.setHeaderColor(bgHex);
      if (tgApp && typeof tgApp.setBackgroundColor === 'function') tgApp.setBackgroundColor(bgHex);
    } catch (_) {}
    syncThemeButtons(mode);
    return effective;
  }

  function setMode(mode) {
    var m = VALID_MODES[mode] ? mode : 'auto';
    try {
      localStorage.setItem(STORAGE_KEY, m);
      localStorage.setItem(LEGACY_KEY, resolveEffectiveTheme(m));
    } catch (_) {}
    return applyTheme(m);
  }

  function cycleMode() {
    var cur = getSavedMode();
    var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
    setMode(next);
    return next;
  }

  applyTheme(getSavedMode());

  try {
    if (g.matchMedia) {
      var mq = g.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (getSavedMode() === 'auto') applyTheme('auto');
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    }
  } catch (_) {}

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { syncThemeButtons(getSavedMode()); }, { once: true });
    }
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest('.theme-btn#theme, #themeToggleBtn, [data-theme-cycle]');
      if (!btn) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      cycleMode();
    }, true);
  }

  try {
    var tgWa = g.Telegram && g.Telegram.WebApp;
    if (tgWa && typeof tgWa.onEvent === 'function') {
      tgWa.onEvent('themeChanged', function () {
        if (getSavedMode() === 'auto') applyTheme('auto');
      });
    }
    if (typeof g.addEventListener === 'function') {
      g.addEventListener('storage', function (ev) {
        if (ev && ev.key === STORAGE_KEY) applyTheme(getSavedMode());
      });
    }
  } catch (_) {}

  g.CoffeeTheme = {
    getMode: getSavedMode,
    setMode: setMode,
    cycleMode: cycleMode,
    getEffectiveTheme: function () { return resolveEffectiveTheme(getSavedMode()); },
    applyTheme: applyTheme
  };
})(typeof window !== 'undefined' ? window : this);
