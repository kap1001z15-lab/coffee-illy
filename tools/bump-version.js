'use strict';
/* Использование: node tools/bump-version.js 85 — синхронно обновляет версию в version.js, HTML, app.js, js/material-design.js, Code.gs и документации .md */
const fs = require('fs'), path = require('path');
const n = String(process.argv[2] || '').replace(/^v/, '');
if (!/^\d+$/.test(n)) { console.error('Укажите номер версии, например: node tools/bump-version.js 85'); process.exit(1); }
const root = path.join(__dirname, '..');
const vf = path.join(root, 'version.js');
if (fs.existsSync(vf)) {
  const v0 = fs.readFileSync(vf, 'utf8');
  const v1 = v0
    .replace(/\(v\d+\)/g, '(v' + n + ')')
    .replace(/COFFEE_VERSION = 'v\d+'/g, "COFFEE_VERSION = 'v" + n + "'")
    .replace(/COFFEE_APP_VERSION = 'v\d+'/g, "COFFEE_APP_VERSION = 'v" + n + "'")
    .replace(/COFFEE_BUILD_NUMBER = \d+/g, "COFFEE_BUILD_NUMBER = " + n)
    .replace(/Coffee Illy Premium v\d+/g, "Coffee Illy Premium v" + n);
  fs.writeFileSync(vf, v1, 'utf8');
}
let files = 0;
fs.readdirSync(root).filter((f) => f.endsWith('.html')).concat(['app.js']).forEach((f) => {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) return;
  const s = fs.readFileSync(p, 'utf8');
  const t = s
    .replace(/(\.(?:js|css)\?v=)\d+/g, '$1' + n)
    .replace(/Coffee Illy v\d+/g, 'Coffee Illy v' + n);
  if (t !== s) { fs.writeFileSync(p, t, 'utf8'); files++; }
});
const md3Path = path.join(root, 'js/material-design.js');
if (fs.existsSync(md3Path)) {
  const m0 = fs.readFileSync(md3Path, 'utf8');
  const m1 = m0
    .replace(/version:\s*'M3-v\d+'/g, "version: 'M3-v" + n + "'")
    .replace(/Material Design 3 \(v\d+\)/g, "Material Design 3 (v" + n + ")");
  if (m1 !== m0) { fs.writeFileSync(md3Path, m1, 'utf8'); files++; }
}
const gasPath = path.join(root, 'Code.gs');
if (fs.existsSync(gasPath)) {
  const g0 = fs.readFileSync(gasPath, 'utf8');
  const g1 = g0
    .replace(/serverVersion:\s*'v\d+'/g, "serverVersion: 'v" + n + "'")
    .replace(/COFFEE_SERVER_VERSION_V82\s*=\s*'v\d+'/g, "COFFEE_SERVER_VERSION_V82 = 'v" + n + "'")
    .replace(/СИСТЕМА КОФЕЙНЯ v\d+ ГОТОВА К РАБОТЕ/g, 'СИСТЕМА КОФЕЙНЯ v' + n + ' ГОТОВА К РАБОТЕ')
    .replace(/☕ Кофейня ERP v\d+/g, '☕ Кофейня ERP v' + n);
  if (g1 !== g0) { fs.writeFileSync(gasPath, g1, 'utf8'); files++; }
}
['PATCH_NOTES.md', 'ARCHITECTURE_V22.md', 'AUDIT_REPORT.md', 'SALES_RECONCILIATION_README.md', 'TECHNICAL_SPECIFICATION.md', 'COFFEE_ILLY_CONCEPT.md', 'BUSINESS_LOGIC_MAP.md', 'API_CONTRACTS.md', 'DESIGN_SYSTEM.md', 'BARISTA_UX_SPEC.md', 'OWNER_UX_SPEC.md', 'MIGRATION_PLAN.md', 'TEST_PLAN.md'].forEach((md) => {
  const mp = path.join(root, md);
  if (fs.existsSync(mp)) {
    const m0 = fs.readFileSync(mp, 'utf8');
    const m1 = m0
      .replace(/^# PATCH NOTES — Система «Кофейня» \(v\d+.*\)/m, '# PATCH NOTES — Система «Кофейня» (v' + n + ' Enterprise Edition)')
      .replace(/Актуальная версия: v\d+/g, 'Актуальная версия: v' + n)
      .replace(/Актуальный статус релиза: v\d+/g, 'Актуальный статус релиза: v' + n)
      .replace(/serverVersion: 'v\d+'/g, "serverVersion: 'v" + n + "'");
    if (m1 !== m0) { fs.writeFileSync(mp, m1, 'utf8'); files++; }
  }
});
console.log('Версия v' + n + ': version.js + ' + files + ' файлов (включая Code.gs и документацию) обновлено');
