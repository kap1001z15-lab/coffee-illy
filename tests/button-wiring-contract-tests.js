'use strict';
// Static wiring checks complement the data-model tests. They do not replace browser/GAS E2E.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'js/page-admin.js'), 'utf8');
const owner = fs.readFileSync(path.join(root, 'owner.html'), 'utf8');
const terminal = fs.readFileSync(path.join(root, 'js/page-terminal.js'), 'utf8');
const htmlFiles = ['index.html','barista.html','dashboard.html','report.html','admin.html','owner.html'];
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; process.stdout.write('[PASS] ' + name + '\n'); }
  catch (e) { failed++; process.stderr.write('[FAIL] ' + name + ': ' + e.message + '\n'); }
}
function assert(v, m) { if (!v) throw new Error(m); }

check('Every data-a action rendered by admin module has a delegated action handler', () => {
  const rendered = new Set([...admin.matchAll(/data-a=\\?"([^"\\]+)"/g)].map(x => x[1]));
  const handled = new Set([...admin.matchAll(/if\s*\(a\s*===\s*'([^']+)'/g)].map(x => x[1]));
  // These two are handled together in a combined conditional.
  handled.add('task-up'); handled.add('task-down');
  for (const action of rendered) assert(handled.has(action), 'No handler for data-a="' + action + '"');
});
check('Task reorder buttons route to the server reorder_task action', () => {
  assert(/if\(a==='task-up'\|\|a==='task-down'\)return act\('reorder_task'/.test(admin), 'Missing task reorder handler');
});
check('Admin forms prevent accidental default submission and await save result', () => {
  assert(/\$\('dform'\)\.onsubmit=async\(e\)=>\{e\.preventDefault\(\)/.test(admin), 'Dialog form submit handler missing');
  assert(/await onSave\(o\)/.test(admin), 'Dialog does not await persistence');
});
check('Owner PIN is stored as a one-way hash, not plaintext, after changing it', () => {
  assert(owner.includes("localStorage.setItem(PIN_KEY,hash?'sha256:'+hash:'')"), 'Owner embedded panel still stores raw PIN');
  assert(admin.includes("localStorage.setItem(PIN_KEY,hash?'sha256:'+hash:'')"), 'Standalone admin panel still stores raw PIN');
});
check('Terminal delegated handlers exist for dynamic task completion and announcements', () => {
  assert(terminal.includes("addEventListener(\"click\"" ) || terminal.includes("addEventListener('click'"), 'Terminal click delegation missing');
  assert(terminal.includes('data-ptaskdone') && terminal.includes('data-ackinfo'), 'Dynamic terminal action selectors missing');
});
check('Every shipped HTML page has no duplicate element IDs', () => {
  for (const file of htmlFiles) {
    const s = fs.readFileSync(path.join(root,file),'utf8');
    const ids = [...s.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1]);
    const seen = new Set();
    for (const id of ids) { if (id.endsWith('_')) continue; assert(!seen.has(id), file + ' duplicates id="' + id + '"'); seen.add(id); }
  }
});
process.stdout.write('\nИТОГО ПРОВЕРОК ПОДКЛЮЧЕНИЯ КНОПОК: ' + passed + '/' + (passed+failed) + '\n');
if (failed) process.exitCode = 1;
