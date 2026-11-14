'use strict';
/* Использование: node tools/bump-version.js 65 — синхронно обновляет версию в version.js, HTML, app.js, Code.gs и документации .md */
const fs = require('fs'), path = require('path');
const n = String(process.argv[2] || '').replace(/^v/, '');
if (!/^\d+$/.test(n)) { console.error('Укажите номер версии, например: node tools/bump-version.js 65'); process.exit(1); }
const root = path.join(__dirname, '..');
const vf = path.join(root, 'version.js');
fs.writeFileSync(vf, fs.readFileSync(vf, 'utf8').replace(/COFFEE_VERSION = 'v\d+'/, "COFFEE_VERSION = 'v" + n + "'"));
let files = 0;
fs.readdirSync(root).filter((f) => f.endsWith('.html')).concat(['app.js']).forEach((f) => {
  const p = path.join(root, f); const s = fs.readFileSync(p, 'utf8');
  const t = s.replace(/(\.(?:js|css)\?v=)\d+/g, '$1' + n);
  if (t !== s) { fs.writeFileSync(p, t); files++; }
});
const gasPath = path.join(root, 'Code.gs');
if (fs.existsSync(gasPath)) {
  const g0 = fs.readFileSync(gasPath, 'utf8');
  const g1 = g0
    .replace(/serverVersion:\s*'v\d+'/g, "serverVersion: 'v" + n + "'")
    .replace(/СИСТЕМА КОФЕЙНЯ v\d+ ГОТОВА К РАБОТЕ/g, 'СИСТЕМА КОФЕЙНЯ v' + n + ' ГОТОВА К РАБОТЕ')
    .replace(/☕ Кофейня ERP v\d+/g, '☕ Кофейня ERP v' + n);
  if (g1 !== g0) { fs.writeFileSync(gasPath, g1); files++; }
}
['PATCH_NOTES.md', 'ARCHITECTURE_V22.md', 'AUDIT_REPORT.md', 'SALES_RECONCILIATION_README.md'].forEach((md) => {
  const mp = path.join(root, md);
  if (fs.existsSync(mp)) {
    const m0 = fs.readFileSync(mp, 'utf8');
    const m1 = m0
      .replace(/Актуальная версия: v\d+/g, 'Актуальная версия: v' + n)
      .replace(/Актуальный статус релиза: v\d+/g, 'Актуальный статус релиза: v' + n)
      .replace(/`v\d+`/g, '`v' + n + '`')
      .replace(/serverVersion: 'v\d+'/g, "serverVersion: 'v" + n + "'");
    if (m1 !== m0) { fs.writeFileSync(mp, m1); files++; }
  }
});
console.log('Версия v' + n + ': version.js + ' + files + ' файлов (включая Code.gs и документацию) обновлено');
