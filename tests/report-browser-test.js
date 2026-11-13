'use strict';
/* Браузерный тест раздела «Отчёты» (Playwright). Запуск: python3 -m http.server 8765 & node tests/report-browser-test.js */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/owner.html';
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(BASE); await pg.waitForTimeout(800);
  await pg.evaluate(() => {
    window.coffeeAuth.createLocalSession('admin', 'Владелец', '1234');
    const iso = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    for (let i = 0; i < 14; i++) window.applyLocalMutation({ action: 'admin_cash', date: iso(i), cash: 1000 + (i < 7 ? 400 : 0), card: 900, checks: 60, barista: 'Соня', products: [{ name: 'Капучино ILLY', qty: 20 }] });
    document.querySelector('[data-osec="report"]').click();
  });
  await pg.click('[data-orp="7"]'); await pg.waitForTimeout(300);
  const r = await pg.evaluate(() => ({
    sticky: !!document.querySelector('.rep-sticky'), hl: !!document.querySelector('.rep-hl'),
    delta: /[▲▼]/.test(document.getElementById('ownerSecReport').textContent),
    est: /≈/.test(document.getElementById('rep-s3').textContent),
    sheets: window._ownerRepExport.sheets.length,
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 2
  }));
  const ok = r.sticky && r.hl && r.delta && r.est && r.sheets === 6 && !errs.length;
  console.log(ok ? '[PASS] Отчёты: сводка, сравнение, цены ТТК, Excel' : '[FAIL] ' + JSON.stringify(r) + errs.join(';'));
  console.log('horizontal scroll at 390px:', r.hscroll);
  await b.close(); process.exit(ok ? 0 : 1);
})();
