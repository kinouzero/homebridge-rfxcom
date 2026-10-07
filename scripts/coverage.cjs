// Keep reports on disk and print the summary even when tests fail.
const { spawnSync } = require('node:child_process');
const { mkdirSync, readdirSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');

const root = resolve(__dirname, '..');
const output = join(root, 'coverage');
const summary = join(output, 'summary.txt');
mkdirSync(output, { recursive: true });
for (const name of ['summary.txt', 'lcov.info']) rmSync(join(output, name), { force: true });

const tests = readdirSync(join(root, 'test'))
  .filter(name => name.endsWith('.test.cjs'))
  .sort()
  .map(name => join('test', name));
const result = spawnSync(process.execPath, [
  '--test',
  '--experimental-test-coverage',
  '--test-coverage-include=dist/**/*.js',
  '--test-coverage-lines=100',
  '--test-coverage-branches=100',
  '--test-coverage-functions=100',
  '--test-reporter=spec',
  '--test-reporter-destination=coverage/summary.txt',
  '--test-reporter=lcov',
  '--test-reporter-destination=coverage/lcov.info',
  ...tests,
], { cwd: root, stdio: 'inherit' });

if (existsSync(summary)) process.stdout.write(readFileSync(summary, 'utf8'));
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
