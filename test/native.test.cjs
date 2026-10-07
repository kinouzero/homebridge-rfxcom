const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
// Deliberately do not import helpers.cjs: these tests load the installed native driver.
const { RfxCom, Rfy, rfy } = require('rfxcom');
const { RadioCommands } = require('../dist/radioCommands');

test('the installed native serial driver loads and reports a missing port', { timeout: 5000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rfxcom-native-'));
  const device = join(directory, 'missing-port');
  const radio = new RfxCom(device);
  t.after(() => { radio.close(); rmSync(directory, { recursive: true, force: true }); });
  const failed = once(radio, 'connectfailed');
  radio.initialise(() => assert.fail('A nonexistent port cannot initialize'));
  const [message] = await failed;
  assert.ok(message.includes(device), message);
  assert.equal(radio.connected, false);
  assert.equal(radio.serialport.isOpen, false);
});

function transport(t) {
  const writes = [];
  const port = {
    isOpen: true,
    write(buffer, callback) { writes.push({ buffer: [...buffer], callback }); },
    close() { this.isOpen = false; },
  };
  const radio = new RfxCom('/simulated-port', { port });
  radio.connected = radio.receiving = true;
  const transmitter = new Rfy(radio, rfy.RFY);
  const failures = [];
  const commands = new RadioCommands(radio, transmitter, error => failures.push(error));
  commands.setConnected(true);
  t.after(() => { commands.dispose(); radio.close(); });
  const respond = (sequence, code) => radio.parser.write(Buffer.from([4, 2, 1, sequence, code]));
  return { radio, transmitter, commands, writes, respond, failures };
}

for (const [command, code] of [['up', 1], ['down', 3], ['stop', 0]]) {
  test('real RFY ' + command + ' encoding and parser preserve the write/ACK contract', { timeout: 5000 }, async t => {
    const f = transport(t);
    let written = 0;
    let completed = false;
    const result = new Promise((resolve, reject) => {
      f.commands.send(command, '0x123/1', () => written++, error => {
        completed = true;
        if (error) reject(error);
        else resolve();
      });
    });
    assert.equal(f.writes.length, 1);
    const { buffer, callback } = f.writes[0];
    const sequence = buffer[3];
    assert.deepEqual(buffer, [12, 0x1a, rfy.RFY, sequence, 0, 1, 0x23, 1, code, 0, 0, 0, 0]);
    assert.equal(written, 0);
    f.respond(sequence, 1);
    assert.equal(completed, false);
    callback(null);
    await result;
    assert.equal(written, 1);
    assert.equal(f.failures.length, 0);
    assert.equal(f.radio.acknowledge[sequence], null);
  });
}

test('real transmitter NAK decoding rejects the matching command without disabling USB', async t => {
  const f = transport(t);
  const result = new Promise((resolve, reject) => {
    f.commands.send('up', '0x123/1', () => {}, error => error ? reject(error) : resolve());
  });
  const rejected = assert.rejects(result, /code 2/);
  f.writes[0].callback(null);
  f.respond(f.writes[0].buffer[3], 2);
  await rejected;
  assert.equal(f.failures.length, 0);
  assert.equal(f.radio.connected, true);
});
