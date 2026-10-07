const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const result = spawnSync(process.execPath, [
  process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json',
], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.stderr || String(result.error));
  process.exit(result.status ?? 1);
}
const [pack] = JSON.parse(result.stdout);
const manifest = require('../package.json');
const lock = require('../package-lock.json');
const { PLUGIN_NAME } = require('../dist/settings.js');
assert.equal(PLUGIN_NAME, manifest.name, 'Homebridge plugin identifier must match the npm package name');
assert.equal(pack.name, manifest.name, 'Packed name must match the manifest');
assert.equal(lock.name, manifest.name, 'Lockfile name must match the manifest');
assert.equal(lock.packages[''].name, manifest.name, 'Root lockfile name must match the manifest');
assert.equal(pack.version, manifest.version, 'Packed version must match the manifest');
assert.equal(lock.version, manifest.version, 'Lockfile version must match the manifest');
assert.equal(lock.packages[''].version, manifest.version, 'Root lockfile package must match the manifest');
assert.deepEqual(lock.packages[''].engines, manifest.engines, 'Lockfile runtime requirements must match the manifest');
const paths = new Set(pack.files.map(file => file.path));
for (const file of ['dist/index.js', 'dist/platform.js', 'dist/shutter.js', 'dist/radioCommands.js',
  'dist/settings.js', 'dist/types.js', 'config.schema.json', 'package.json', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
  assert.ok(paths.has(file), 'Missing package file: ' + file);
}
assert.ok(!paths.has('dist/switch.js'), 'Removed switch implementation must not be shipped');
for (const file of paths) {
  assert.ok(!/^(test|coverage|node_modules|src|scripts|\.github)\//.test(file), 'Development file in package: ' + file);
}
console.log('npm package ' + pack.version + ' verified: ' + paths.size + ' files; no development files.');
