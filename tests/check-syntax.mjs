import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const jsFiles = [
  'config.js',
  'config.example.js',
  'version.js',
  'sw.js',
  'js/camera.js',
  'js/cloud-sync.js',
  'js/pos-csv-parser.js',
  'js/time-picker.js',
  'js/custom-select.js'
];

for (const rel of jsFiles) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  new vm.Script(src, { filename: rel });
  console.log('✓ JS syntax OK:', rel);
}

for (const htmlRel of ['index.html', 'dashboard.html', 'owner.html']) {
  const html = fs.readFileSync(path.join(root, htmlRel), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) {
    throw new Error(`No inline <script> blocks found in ${htmlRel}`);
  }
  blocks.forEach((m, idx) => {
    new vm.Script(m[1], { filename: `${htmlRel}#inline-${idx}` });
  });
  console.log(`✓ HTML inline scripts OK: ${htmlRel} (${blocks.length} blocks)`);
}
