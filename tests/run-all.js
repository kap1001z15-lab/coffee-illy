const { execFileSync } = require('child_process');
const path = require('path');

const suites = [
  'tests/unit-tests.js',
  'tests/ui-buttons-e2e-tests.js',
  'tests/v4-security-and-isolation-tests.js',
  'tests/gas-anon-access-tests.js',
  'tests/gas-server-security-tests.js',
  'tests/integration-contract-tests.js',
  'tests/transport-runtime-tests.js',
  'tests/live-sync-tests.js',
  'tests/report-browser-test.js',
  'tests/two-device-sync-e2e-tests.js'
];

let failed = 0;
for (const s of suites) {
  try {
    execFileSync(process.execPath, [path.resolve(__dirname, '..', s)], { stdio: 'inherit' });
    console.log('[SUITE PASS]', s);
  } catch (err) {
    console.error('[SUITE FAIL]', s);
    failed++;
  }
}
console.log(`\n=== ИТОГО НАБОРОВ ТЕСТОВ: ${suites.length - failed}/${suites.length} ===`);
process.exit(failed > 0 ? 1 : 0);
