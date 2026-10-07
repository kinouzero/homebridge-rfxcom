const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const manifest = require('../package.json');

function check(t, { version = manifest.version, tag = 'v' + version, lockVersion = version, rootVersion = version } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rfxcom-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve(__dirname, '../scripts/check-release.cjs'), join(root, 'scripts/check-release.cjs'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: lockVersion, packages: { '': { version: rootVersion } } }));
  return spawnSync(process.execPath, ['scripts/check-release.cjs'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_REF_NAME: tag },
  });
}

test('release validation accepts a matching stable version and lockfile', t => {
  const result = check(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release tag verified/);
});
for (const tag of ['', 'master', manifest.version, 'v99.0.0', 'v' + manifest.version + '-beta.1']) {
  test('release validation rejects tag ' + JSON.stringify(tag), t => {
    const result = check(t, { tag });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must exactly match/);
  });
}
for (const version of ['2.0.0-beta.1', '2.0.0+build.1', '02.0.0']) {
  test('release validation prevents non-stable version ' + version + ' from reaching latest', t => {
    const result = check(t, { version });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Only stable releases/);
  });
}
for (const key of ['lockVersion', 'rootVersion']) {
  test('release validation rejects inconsistent ' + key, t => {
    const result = check(t, { [key]: '99.0.0' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lockfile|Lockfile/);
  });
}
