'use strict';
/* Использование: node tools/bump-version.js 53  — меняет версию в version.js и в параметрах ?v= всех страниц. */
const fs = require('fs'), path = require('path');
const n = String(process.argv[2] || '').replace(/^v/, '');
if (!/^\d+$/.test(n)) { console.error('Укажите номер версии, например: node tools/bump-version.js 53'); process.exit(1); }
const root = path.join(__dirname, '..');
const vf = path.join(root, 'version.js');
fs.writeFileSync(vf, fs.readFileSync(vf, 'utf8').replace(/COFFEE_VERSION = 'v\d+'/, "COFFEE_VERSION = 'v" + n + "'"));
let files = 0;
fs.readdirSync(root).filter((f) => f.endsWith('.html')).concat(['app.js']).forEach((f) => {
  const p = path.join(root, f); const s = fs.readFileSync(p, 'utf8');
  const t = s.replace(/(\.(?:js|css)\?v=)\d+/g, '$1' + n);
  if (t !== s) { fs.writeFileSync(p, t); files++; }
});
console.log('Версия v' + n + ': version.js + ' + files + ' файлов обновлено');
