const assert = require('node:assert/strict');
const manifest = require('../package.json');
const lock = require('../package-lock.json');
const tag = process.env.GITHUB_REF_NAME;

assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Only stable releases can be published to latest');
assert.equal(tag, 'v' + manifest.version, 'Release tag must exactly match v<package.json version>');
assert.equal(lock.version, manifest.version, 'Lockfile version must match the release');
assert.equal(lock.packages[''].version, manifest.version, 'Root lockfile package must match the release');
console.log('Release tag verified: ' + tag);
