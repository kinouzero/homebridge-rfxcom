const test = require('node:test');
const assert = require('node:assert/strict');
const { Radio, Rfy, Clock } = require('./helpers.cjs');
const { RadioCommands } = require('../dist/radioCommands');
const { COMMAND_TIMEOUT_MS } = require('../dist/settings');

function fixture(t) {
  const clock = new Clock();
  const radio = new Radio('/dev/test', { debug: false });
  const rfy = new Rfy(radio);
  const failures = [];
  const commands = new RadioCommands(radio, rfy, error => failures.push(error));
  commands.setConnected(true);
  t.after(() => { commands.dispose(); clock.restore(); });
  return { clock, radio, rfy, commands, failures };
}
function send(f, onWritten = () => {}) {
  return new Promise((resolve, reject) => {
    f.commands.send('up', '0x123/1', onWritten, error => error ? reject(error) : resolve());
  });
}
for (const code of [0, 1]) {
  test('accepts matching ACK code ' + code + ' after serial write', async t => {
    const f = fixture(t);
    f.rfy.ackCode = code;
    let writes = 0;
    await send(f, () => writes++);
    assert.equal(writes, 1);
    assert.equal(f.clock.pending, 0);
    assert.equal(f.failures.length, 0);
  });
}
for (const code of [2, 3, 4, 5, 9]) {
  test('rejects transmitter response code ' + code + ' without disconnecting other devices', async t => {
    const f = fixture(t);
    f.rfy.ackCode = code;
    await assert.rejects(send(f), new RegExp('code ' + code));
    assert.equal(f.failures.length, 0);
    assert.equal(f.clock.pending, 0);
    f.rfy.ackCode = 0;
    await send(f);
  });
}
test('ACK before write does not complete a command or start its position estimate', async t => {
  const f = fixture(t);
  f.rfy.autoWrite = false;
  let writes = 0;
  let completed = false;
  const result = send(f, () => writes++).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(writes, 0);
  assert.equal(completed, false);
  f.rfy.sent[0].write();
  await result;
  assert.equal(writes, 1);
  assert.equal(f.clock.pending, 0);
});
test('write without ACK waits for the matching response and ignores other sequences', async t => {
  const f = fixture(t);
  f.rfy.autoAck = false;
  let completed = false;
  const result = send(f).then(() => { completed = true; });
  f.radio.respond(200, 5);
  await Promise.resolve();
  assert.equal(completed, false);
  f.rfy.sent[0].ack();
  await result;
});
test('concurrent commands correlate out-of-order ACKs without adding listeners per command', async t => {
  const f = fixture(t);
  f.rfy.autoAck = false;
  const first = send(f);
  const second = send(f);
  assert.equal(f.radio.listenerCount('response'), 1);
  f.rfy.sent[1].ack();
  await second;
  assert.equal(f.clock.pending, 1);
  f.rfy.sent[0].ack();
  await first;
  assert.equal(f.clock.pending, 0);
});
test('missing write and ACK times out, disables transmission, and ignores late callbacks', async t => {
  const f = fixture(t);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  let writes = 0;
  const rejected = assert.rejects(send(f, () => writes++), /timed out/);
  f.clock.tick(COMMAND_TIMEOUT_MS);
  await rejected;
  f.rfy.sent[0].write();
  f.rfy.sent[0].ack();
  assert.equal(writes, 0);
  assert.equal(f.failures.length, 1);
  await assert.rejects(send(f), /unavailable/);
  assert.equal(f.rfy.calls.length, 1);
});
test('serial write failure fails pending commands and signals connection failure', async t => {
  const f = fixture(t);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const first = assert.rejects(send(f), /USB error/);
  const second = assert.rejects(send(f), /USB error/);
  f.rfy.sent[0].write(new Error('USB error'));
  await Promise.all([first, second]);
  assert.equal(f.failures.length, 1);
  assert.equal(f.clock.pending, 0);
});
test('transmitter timeout is a connection failure', async t => {
  const f = fixture(t);
  f.rfy.ackCode = 6;
  await assert.rejects(send(f), /response timeout/);
  assert.equal(f.failures.length, 1);
});
test('synchronous encoder errors and invalid sequences fail without leaking timers', async t => {
  const f = fixture(t);
  f.rfy.throwError = 'Invalid address';
  await assert.rejects(send(f), /Invalid address/);
  f.rfy.throwError = undefined;
  f.rfy.sequenceResult = -1;
  await assert.rejects(send(f), /Invalid RFXtrx command sequence/);
  assert.equal(f.clock.pending, 0);
});
test('repeated writes and ACKs call each completion once', async t => {
  const f = fixture(t);
  let writes = 0;
  let completions = 0;
  f.commands.send('up', '0x123/1', () => writes++, error => {
    assert.ifError(error);
    completions++;
  });
  f.rfy.sent[0].write(new Error('late'));
  f.rfy.sent[0].ack(5);
  assert.equal(writes, 1);
  assert.equal(completions, 1);
});
test('dispose removes the response listener and rejects outstanding commands', async t => {
  const f = fixture(t);
  f.rfy.autoAck = false;
  const rejected = assert.rejects(send(f), /connection closed/);
  f.commands.dispose();
  await rejected;
  assert.equal(f.radio.listenerCount('response'), 0);
  assert.equal(f.clock.pending, 0);
});


test('closing from the write notification completes an early-ACK command only once', t => {
  const f = fixture(t);
  f.rfy.autoWrite = false;
  const results = [];
  f.commands.send('up', '0x123/1', () => f.commands.dispose(), error => results.push(error));
  f.rfy.sent[0].write();
  assert.equal(results.length, 1);
  assert.match(results[0].message, /connection closed/);
  assert.equal(f.clock.pending, 0);
  assert.equal(f.radio.listenerCount('response'), 0);
});

test('an already dispatched timeout cannot disconnect a completed command', async t => {
  const f = fixture(t);
  f.rfy.autoAck = false;
  const result = send(f);
  const timeout = [...f.clock.timers.values()][0].fn;
  f.rfy.sent[0].ack();
  await result;
  timeout();
  assert.equal(f.failures.length, 0);
  assert.equal(f.clock.pending, 0);
  f.rfy.autoAck = true;
  await send(f);
});
