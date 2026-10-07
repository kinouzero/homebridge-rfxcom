const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const { schema } = require('../config.schema.json');
const validate = new Ajv({ allErrors: true }).addKeyword('placeholder').compile(schema);
const remote = { name: 'Salon', deviceID: '0x123/1' };
function valid(options) {
  return validate({ name: 'RFXCom', rfyRemotes: [{ ...remote, ...options }] });
}
test('schema accepts directional durations, fractions and courses over 60 seconds', () => {
  for (const options of [{}, { upSeconds: 120, downSeconds: 120 }, { upSeconds: 12.5, downSeconds: 130.75 }, { reverse: true }]) {
    assert.equal(valid(options), true, JSON.stringify(validate.errors));
  }
});
for (const key of ['upSeconds', 'downSeconds']) {
  test('schema requires positive numeric ' + key, () => {
    for (const value of [0, -1, '25', null]) assert.equal(valid({ [key]: value }), false);
    assert.equal(valid({ [key]: 0.001 }), true);
  });
}
test('schema rejects invalid RFY addresses and blank names', () => {
  for (const deviceID of ['0x000000/1', '0x100000/1', '0x123/5', 'not-an-id']) {
    assert.equal(valid({ deviceID }), false);
  }
  for (const deviceID of ['0x1/0', '0x0fffff/4', '0x000001/1']) assert.equal(valid({ deviceID }), true);
  for (const name of ['', '   ']) assert.equal(valid({ name }), false);
  assert.equal(valid({ reverse: 'false' }), false);
});
test('schema no longer advertises switch accessories', () => {
  assert.equal(schema.properties.withSwitches, undefined);
});

test('v2 schema rejects old duration fields, misspelled device keys and unknown options', () => {
  for (const options of [{ openCloseSeconds: 25 }, { deviceId: '0x123/1' }, { extra: true }]) {
    assert.equal(valid(options), false);
  }
  assert.equal(validate({ name: 'RFXCom', RfyRemotes: [remote] }), false);
  assert.equal(valid({}), true);
});

test('the documented configuration example validates against the v2 schema', () => {
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');
  const example = JSON.parse(readme.match(/```json\n([\s\S]*?)```/)[1]);
  assert.equal(validate(example.platforms[0]), true, JSON.stringify(validate.errors));
});
