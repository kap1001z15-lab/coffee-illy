/* =========================================================================
   COFFEE ILLY v4.0 — УПРАВЛЕНИЕ ТЕМОЙ (Auto / Light / Dark)
   Подключается в <head> до основного CSS для предотвращения вспышки темы.
   ========================================================================= */
(function (g) {
  var STORAGE_KEY = 'coffee_illy_theme_v4';
  var LEGACY_KEY = 'coffee_illy_theme';
  var VALID_MODES = { auto: true, light: true, dark: true };

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

  function applyTheme(modeOpt) {
    var mode = VALID_MODES[modeOpt] ? modeOpt : getSavedMode();
    var effective = resolveEffectiveTheme(mode);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', effective);
      document.documentElement.setAttribute('data-theme-mode', mode);
    }
    try {
      var meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null;
      if (meta) meta.setAttribute('content', effective === 'dark' ? '#141413' : '#F7F5F0');
    } catch (_) {}
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
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest('.theme-btn, #themeToggleBtn');
      if (!btn) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      var next = cycleMode();
      var titles = { auto: 'Тема: Авто', light: 'Тема: Светлая', dark: 'Тема: Тёмная' };
      btn.setAttribute('title', titles[next] || 'Тема');
      btn.setAttribute('aria-label', titles[next] || 'Тема');
    }, true);
  }

  g.CoffeeTheme = {
    getMode: getSavedMode,
    setMode: setMode,
    cycleMode: cycleMode,
    getEffectiveTheme: function () { return resolveEffectiveTheme(getSavedMode()); },
    applyTheme: applyTheme
  };
})(typeof window !== 'undefined' ? window : this);
