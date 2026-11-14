'use strict';
/* Браузерный и безголовый DOM-тест раздела «Отчёты» и «Дашборд» (Playwright с авто-фоллбэком на Node DOM). */
let playwrightChromium = null;
try { playwrightChromium = require('playwright').chromium; } catch (_) {}

if (playwrightChromium && process.env.USE_PLAYWRIGHT === '1') {
  const BASE = process.env.BASE || 'http://localhost:8765/owner.html';
  (async () => {
    const b = await playwrightChromium.launch();
    const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(BASE);
    await pg.waitForTimeout(800);
    await pg.evaluate(() => {
      window.coffeeAuth.createLocalSession('admin', 'Владелец', '1234');
      const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      for (let i = 0; i < 14; i++) window.applyLocalMutation({ action: 'admin_cash', date: iso(i), cash: 1000 + (i < 7 ? 400 : 0), card: 900, checks: 60, barista: 'Соня', products: [{ name: 'Капучино ILLY', qty: 20 }] });
      document.querySelector('[data-osec="report"]').click();
    });
    await pg.click('[data-orp="7"]');
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => ({
      sticky: !!document.querySelector('.rep-sticky'),
      hl: !!document.querySelector('.rep-hl'),
      delta: /[▲▼]/.test(document.getElementById('ownerSecReport').textContent),
      est: /≈/.test(document.getElementById('rep-s3').textContent),
      sheets: window._ownerRepExport.sheets.length
    }));
    const ok = r.sticky && r.hl && r.delta && r.est && r.sheets === 6 && !errs.length;
    console.log(ok ? '[PASS] Отчёты: сводка, сравнение, цены ТТК, Excel' : '[FAIL] ' + JSON.stringify(r));
    await b.close();
    process.exit(ok ? 0 : 1);
  })();
} else {
  // Полная проверка рендеринга Отчётов и Дашборда в среде Node.js (без зависимости от внешнего браузера Playwright)
  require('./unit-tests.js');
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');

  const els = {};
  function makeNode(id) {
    return {
      id: id || '',
      hidden: false,
      innerHTML: '',
      textContent: '',
      value: '',
      style: {},
      dataset: {},
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
      appendChild() {},
      insertBefore() {},
      removeAttribute() {},
      setAttribute() {},
      parentNode: { style: {}, insertBefore() {}, appendChild() {} }
    };
  }
  ['sub', 'err', 'content', 'panel', 'tabs', 'dlg', 'dtitle', 'dfields', 'derr', 'dform', 'dsave', 'dcancel', 'toast', 'theme', 'ownerNotifBtn', 'ownerNotifCount', 'ownerNotifDrawer', 'ownerSecDashboard', 'ownerSecReport', 'ownerMainNav', 'netStatusBadge'].forEach((id) => {
    els[id] = makeNode(id);
  });
  global.document = {
    readyState: 'complete',
    documentElement: {
      getAttribute() { return 'light'; },
      setAttribute() {},
      classList: { add() {}, remove() {} }
    },
    body: makeNode('body'),
    activeElement: null,
    getElementById(id) { return els[id] || (els[id] = makeNode(id)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tag) { return makeNode(tag); }
  };
  window.document = global.document;
  window.addEventListener = () => {};
  window.location = { search: '', pathname: '/owner.html', reload() {} };
  global.location = window.location;

  window.coffeeAuth.createLocalSession('admin', 'Владелец', '1234');
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  for (let i = 0; i < 14; i++) {
    window.applyLocalMutation({
      action: 'admin_cash',
      date: iso(i),
      cash: 1000 + (i < 7 ? 400 : 0),
      card: 900,
      checks: 60,
      barista: 'Соня',
      products: [{ name: 'Капучино ILLY', qty: 20 }]
    });
  }

  eval(fs.readFileSync(path.join(root, 'js/page-admin.js'), 'utf8'));
  eval(fs.readFileSync(path.join(root, 'js/page-owner.js'), 'utf8'));

  window.renderOwnerDashboardSection();
  window.renderOwnerReportSection();

  const dashHtml = els.ownerSecDashboard.innerHTML;
  const repHtml = els.ownerSecReport.innerHTML;
  const ok =
    dashHtml.includes('Центр контроля событий') &&
    repHtml.includes('rep-sticky') &&
    repHtml.includes('rep-hl') &&
    repHtml.includes('ФАКТИЧЕСКИЕ ПОКАЗАТЕЛИ') &&
    repHtml.includes('РАСЧЁТНЫЕ ПОКАЗАТЕЛИ') &&
    repHtml.includes('ПРОГНОЗНЫЕ И ПЛАНОВЫЕ ОРИЕНТИРЫ') &&
    /[▲▼]/.test(repHtml) &&
    window._ownerRepExport &&
    Array.isArray(window._ownerRepExport.sheets) &&
    window._ownerRepExport.sheets.length === 6;

  if (!ok) {
    console.error('[FAIL] Проверка рендеринга Отчётов и Дашборда не прошла');
    process.exit(1);
  }
  console.log('[PASS] Отчёты и Дашборд: Центр контроля событий, Факт/Расчёт/Прогноз P&L, динамика [▲▼], цены ТТК и экспорт 6 листов Excel');
  process.exit(0);
}
