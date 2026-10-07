const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ready, flush, cached, set, hap } = require('./helpers.cjs');
const { COMMAND_TIMEOUT_MS, RECONNECT_INITIAL_MS } = require('../dist/settings');
const remote = { name: 'Salon', deviceID: '0x123/1' };
function device(t, options = {}) { return fixture(t, { rfyRemotes: [{ ...remote, ...options }] }); }

for (const duration of [25, 60, 120]) {
  test('full travel uses ' + duration + ' seconds without rounding drift', async t => {
    const f = device(t, { upSeconds: duration, downSeconds: duration });
    cached(f, '0x123/1', 0);
    const shutter = await ready(f);
    await set(shutter.target, 100);
    f.clock.tick(duration * 500);
    assert.equal(shutter.current.value, 50);
    f.clock.tick(duration * 500);
    assert.equal(shutter.current.value, 100);
    assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
    assert.deepEqual(f.rfy.calls, [['up', '0x123/1']]);
    assert.equal(f.clock.pending, 0);
  });
}
test('position starts at successful serial write rather than submission or early ACK', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  f.rfy.autoWrite = false;
  const move = set(shutter.target, 100);
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 50);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  f.rfy.sent[0].write();
  await move;
  f.clock.tick(5000);
  assert.equal(shutter.current.value, 55);
});
test('write starts estimation but HomeKit completion waits for ACK', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  let completed = false;
  const move = set(shutter.target, 100).then(() => { completed = true; });
  f.clock.tick(1000);
  await flush();
  assert.equal(shutter.current.value, 51);
  assert.equal(completed, false);
  f.rfy.sent[0].ack();
  await move;
  assert.equal(completed, true);
});
test('a missing callback times out without creating a fictional movement and is never replayed', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const rejected = assert.rejects(set(shutter.target, 100));
  const old = f.rfy;
  f.clock.tick(COMMAND_TIMEOUT_MS);
  await rejected;
  assert.equal(shutter.current.value, 50);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  f.clock.tick(RECONNECT_INITIAL_MS);
  await flush();
  old.sent[0].write();
  old.sent[0].ack();
  assert.equal(shutter.current.value, 50);
  assert.equal(f.rfy.calls.length, 0);
});
for (const reverse of [false, true]) {
  for (const [target, command, seconds] of [[100, reverse ? 'down' : 'up', reverse ? 40 : 20],
    [0, reverse ? 'up' : 'down', reverse ? 20 : 40]]) {
    test('directional duration follows physical ' + command + ' with reverse=' + reverse + ' and target=' + target, async t => {
      const f = device(t, { upSeconds: 20, downSeconds: 40, reverse });
      const shutter = await ready(f);
      await set(shutter.target, target);
      f.clock.tick(seconds * 250);
      assert.equal(shutter.current.value, target === 100 ? 75 : 25);
      f.clock.tick(seconds * 250);
      assert.equal(shutter.current.value, target);
      assert.deepEqual(f.rfy.calls, [[command, remote.deviceID]]);
      assert.equal(f.clock.pending, 0);
    });
  }
}
test('partial travel stops at the proportional duration including fractional seconds', async t => {
  const f = device(t, { upSeconds: 12.5 });
  const shutter = await ready(f);
  await set(shutter.target, 51);
  f.clock.tick(124);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.INCREASING);
  f.clock.tick(1);
  assert.equal(shutter.current.value, 51);
  assert.equal(shutter.target.value, 51);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'stop']);
});
test('delayed timer catches up using elapsed time', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(7000, true);
  assert.equal(shutter.current.value, 57);
});
test('direction change uses the current estimate and the duration of the new direction', async t => {
  const f = device(t, { upSeconds: 20, downSeconds: 40 });
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 60);
  await set(shutter.target, 40);
  f.clock.tick(8000);
  assert.equal(shutter.current.value, 40);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'down', 'stop']);
});
test('pending targets coalesce while the active radio command waits for ACK', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  const first = set(shutter.target, 100);
  const superseded = assert.rejects(set(shutter.target, 30));
  const last = set(shutter.target, 20);
  await superseded;
  assert.equal(f.rfy.calls.length, 1);
  f.rfy.autoAck = true;
  f.rfy.sent[0].ack();
  await Promise.all([first, last]);
  assert.equal(shutter.target.value, 20);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'down']);
});
test('same pending and active target do not transmit redundant commands', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  const first = set(shutter.target, 100);
  const duplicate = set(shutter.target, 100);
  assert.equal(f.rfy.calls.length, 1);
  f.rfy.sent[0].ack();
  await Promise.all([first, duplicate]);
  await set(shutter.target, 100);
  assert.equal(f.rfy.calls.length, 1);
});
test('manual STOP and a target equal to the current position stop a moving device', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(10000);
  await set(shutter.target, 60);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'stop']);
  await set(shutter.target, 0);
  await new Promise((resolve, reject) => shutter.stop(error => error ? reject(error) : resolve()));
  assert.equal(f.clock.pending, 0);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'stop', 'down', 'stop']);
});
test('idle STOP and unchanged target do not recall the Somfy favourite position', async t => {
  const f = device(t);
  const shutter = await ready(f);
  shutter.stop();
  await set(shutter.target, 50);
  assert.equal(f.rfy.calls.length, 0);
});
for (const code of [2, 3, 4, 5]) {
  test('NAK ' + code + ' rejects the HomeKit command and stops its estimate without disconnecting USB', async t => {
    const f = device(t);
    const shutter = await ready(f);
    f.rfy.ackCode = code;
    await assert.rejects(set(shutter.target, 100));
    assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
    await assert.rejects(shutter.current.handleGetRequest());
    assert.equal(f.platform.online, true);
    assert.equal(f.clock.pending, 0);
    f.rfy.ackCode = 0;
    await set(shutter.target, 0);
    assert.equal(await shutter.current.handleGetRequest(), 50);
  });
}
test('automatic STOP rejection is logged and exposed as a HomeKit communication error', async t => {
  const f = device(t);
  const shutter = await ready(f);
  await set(shutter.target, 51);
  f.rfy.ackCode = 5;
  f.clock.tick(250);
  await assert.rejects(shutter.current.handleGetRequest());
  assert.ok(f.logs.some(([level, msg]) => level === 'error' && msg.includes('RFY stop failed')));
  assert.equal(f.clock.pending, 0);
});
test('disconnect rejects active and pending commands and discards subsequent writes', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const first = assert.rejects(set(shutter.target, 100));
  const pending = assert.rejects(set(shutter.target, 0));
  f.radio.emit('disconnect');
  await Promise.all([first, pending]);
  f.rfy.sent[0].write();
  assert.equal(shutter.current.value, 50);
  assert.equal(f.rfy.calls.length, 1);
});
test('manual stop cancels pending target changes', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  const first = assert.rejects(set(shutter.target, 100));
  const pending = assert.rejects(set(shutter.target, 0));
  f.rfy.autoAck = true;
  shutter.stop();
  await Promise.all([first, pending]);
  f.rfy.sent[0].ack();
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'stop']);
});
test('invalid targets cannot reach the radio', async t => {
  const f = device(t);
  const shutter = await ready(f);
  for (const value of [NaN, Infinity, -1, 101, '50']) {
    let error;
    shutter.target.emit('set', value, result => { error = result; });
    assert.ok(error instanceof Error);
  }
  assert.equal(f.rfy.calls.length, 0);
});
for (const key of ['upSeconds', 'downSeconds']) {
  for (const value of [0, -1, NaN, Infinity, '25', null]) {
    test('invalid ' + key + ' prevents device registration: ' + value, async t => {
      const f = device(t, { [key]: value });
      assert.equal(await ready(f), undefined);
      assert.equal(f.api.registered.length, 0);
      assert.equal(f.logs.filter(([level]) => level === 'warn').length, 2);
    });
  }
}
test('one directional override leaves the other at its independent default of 25 seconds', async t => {
  const f = device(t, { upSeconds: 30 });
  const shutter = await ready(f);
  await set(shutter.target, 0);
  f.clock.tick(12500);
  assert.equal(shutter.current.value, 0);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  await set(shutter.target, 100);
  f.clock.tick(30000);
  assert.equal(shutter.current.value, 100);
  assert.equal(f.clock.pending, 0);
});
test('reverse remains independent per device and mirrors a v2 cached position when changed', async t => {
  const f = fixture(t, { rfyRemotes: [{ ...remote, reverse: true }, { name: 'Normal', deviceID: '0x124/1' }] });
  f.radio.remotes.push({ deviceId: '0x124/1' });
  const cachedAccessory = cached(f, '0x123/1', 23.4);
  await ready(f);
  const reversed = f.platform.shutter['0x123/1'];
  const normal = f.platform.shutter['0x124/1'];
  assert.equal(cachedAccessory.context.current, 76.6);
  assert.equal(cachedAccessory.context.reverse, true);
  await ready(f);
  assert.equal(cachedAccessory.context.current, 76.6);
  await set(reversed.target, 100);
  await set(normal.target, 100);
  assert.deepEqual(f.rfy.calls, [['down', '0x123/1'], ['up', '0x124/1']]);
});
test('invalid reverse values prevent registration instead of changing direction silently', async t => {
  const f = device(t, { reverse: 'false' });
  assert.equal(await ready(f), undefined);
  assert.equal(f.rfy.calls.length, 0);
  assert.ok(f.logs.some(([level, message]) => level === 'warn' && message.includes('invalid RFY remote')));
});
for (const [value, expected] of [[-20, 0], [130, 100], [NaN, 50], ['20', 50]]) {
  test('cached position ' + value + ' is bounded or replaced by the default', async t => {
    const f = device(t);
    cached(f, '0x123/1', value);
    const shutter = await ready(f);
    assert.equal(shutter.current.value, expected);
  });
}
test('shutdown saves the latest estimate and clears all movement timers', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(1234);
  f.platform.shutdown();
  assert.equal(shutter.accessory.context.current, 51.234);
  assert.equal(f.clock.pending, 0);
  await assert.rejects(set(shutter.target, 0));
});

test('old partial-target STOP is cancelled while a new target awaits its serial write', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 60);
  f.clock.tick(9000);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const move = set(shutter.target, 100);
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 61);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'up']);
  f.rfy.sent[1].write();
  f.rfy.sent[1].ack();
  await move;
  f.clock.tick(39000);
  assert.equal(shutter.current.value, 100);
  assert.equal(f.clock.pending, 0);
});

test('a target crossed while a command waits for writing is corrected in the actual direction', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(5000);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const move = set(shutter.target, 56);
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 57);
  f.rfy.autoWrite = f.rfy.autoAck = true;
  f.rfy.sent[1].write();
  f.rfy.sent[1].ack();
  await move;
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.DECREASING);
  f.clock.tick(1000);
  assert.equal(shutter.current.value, 56);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'up', 'down', 'stop']);
});

test('a delayed STOP write keeps estimating travel until it is written', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 51);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  f.clock.tick(1000);
  assert.equal(f.rfy.sent[1].name, 'stop');
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 53);
  f.rfy.sent[1].ack();
  f.rfy.sent[1].write();
  assert.equal(shutter.target.value, 53);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  assert.equal(f.clock.pending, 0);
});

test('manual STOP failure reports a fault and clears the movement estimate', async t => {
  const f = device(t);
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.clock.tick(1000);
  f.rfy.ackCode = 5;
  shutter.stop();
  assert.equal(shutter.current.value, 54);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  assert.ok(f.logs.some(([level, msg]) => level === 'error' && msg.includes('RFY stop failed')));
  await assert.rejects(shutter.current.handleGetRequest());
  assert.equal(f.clock.pending, 0);
});

test('manual STOP while disconnected reports an error without queuing a command', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.radio.emit('disconnect');
  let error;
  shutter.stop(result => { error = result; });
  assert.match(error.message, /unavailable/);
  assert.equal(f.rfy.calls.length, 0);
});

test('a late NAK for an old manual STOP cannot reset a subsequent movement', async t => {
  const f = device(t);
  const shutter = await ready(f);
  await set(shutter.target, 100);
  f.rfy.autoAck = false;
  let stopError;
  shutter.stop(error => { stopError = error; });
  f.rfy.autoAck = true;
  await set(shutter.target, 0);
  f.rfy.sent[1].ack(5);
  assert.match(stopError.message, /code 5/);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.DECREASING);
  assert.equal(await shutter.current.handleGetRequest(), 50);
  assert.equal(f.clock.pending, 2);
});

test('duplicate serial callbacks before ACK do not restart the elapsed-time clock', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  const move = set(shutter.target, 100);
  f.clock.tick(2000);
  f.rfy.sent[0].write();
  f.rfy.sent[0].ack();
  await move;
  f.clock.tick(1000);
  assert.equal(shutter.current.value, 53);
});


test('restoring an already reversed accessory preserves its position and existing service', async t => {
  const f = device(t, { reverse: true });
  const accessory = new f.api.platformAccessory('Cached', hap.uuid.generate('0x123/1'));
  accessory.context = { current: 23.4, reverse: true };
  const service = accessory.addService(hap.Service.WindowCovering, 'Cached');
  f.platform.configureAccessory(accessory);
  const shutter = await ready(f);
  assert.equal(shutter.accessory.getService(hap.Service.WindowCovering), service);
  assert.equal(shutter.accessory.context.current, 23.4);
  assert.equal(service.displayName, 'Salon');
  assert.equal(shutter.target.listenerCount('set'), 1);
});

test('HomeKit reads fall back to zero when a characteristic has no cached value', async t => {
  const f = device(t);
  const shutter = await ready(f);
  shutter.current.value = null;
  assert.equal(await shutter.current.handleGetRequest(), 0);
});

test('duplicate pending targets share one radio command and both receive its result', async t => {
  const f = device(t);
  const shutter = await ready(f);
  f.rfy.autoAck = false;
  const active = set(shutter.target, 100);
  const first = set(shutter.target, 0);
  const duplicate = set(shutter.target, 0);
  assert.equal(f.rfy.calls.length, 1);
  f.rfy.sent[0].ack();
  await active;
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'down']);
  f.rfy.sent[1].ack();
  await Promise.all([first, duplicate]);
  assert.equal(shutter.target.value, 0);
});

test('a queued target rechecks platform availability before transmitting', async t => {
  const f = device(t);
  const shutter = await ready(f);
  let online = true;
  Object.defineProperty(f.platform, 'online', { get: () => online });
  f.rfy.autoAck = false;
  const first = set(shutter.target, 100);
  const pending = assert.rejects(set(shutter.target, 0));
  online = false;
  f.rfy.sent[0].ack();
  await Promise.all([first, pending]);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up']);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  await assert.rejects(shutter.current.handleGetRequest());
  assert.equal(f.clock.pending, 0);
});

for (const target of [100, 50]) {
  test('a cancelled target ' + target + ' ignores a late serial write after manual STOP', async t => {
    const f = device(t);
    const shutter = await ready(f);
    if (target === 50) await set(shutter.target, 100);
    f.rfy.autoWrite = f.rfy.autoAck = false;
    const index = f.rfy.sent.length;
    const cancelled = assert.rejects(set(shutter.target, target));
    f.rfy.autoWrite = f.rfy.autoAck = true;
    shutter.stop();
    await cancelled;
    f.rfy.sent[index].write();
    f.rfy.sent[index].ack();
    assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
    assert.equal(shutter.current.value, 50);
    assert.equal(f.clock.pending, 0);
  });
}

test('a stale movement deadline cannot stop the replacement movement', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 60);
  const deadline = [...f.clock.timers].find(([id, timer]) => id.refed && !timer.repeat && timer.at === f.clock.now + 10000)[1].fn;
  await set(shutter.target, 0);
  deadline();
  f.clock.tick(1000);
  assert.equal(shutter.current.value, 49);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.DECREASING);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['up', 'down']);
});

for (const automatic of [true, false]) {
  test('a late ' + (automatic ? 'automatic' : 'manual') + ' STOP write cannot reset a newer movement', async t => {
    const f = device(t, { upSeconds: 100, downSeconds: 100 });
    const shutter = await ready(f);
    await set(shutter.target, automatic ? 51 : 100);
    f.rfy.autoWrite = f.rfy.autoAck = false;
    if (automatic) f.clock.tick(1000);
    else shutter.stop();
    const stop = f.rfy.sent[1];
    assert.equal(stop.name, 'stop');
    f.rfy.autoWrite = f.rfy.autoAck = true;
    await set(shutter.target, 0);
    stop.write();
    stop.ack();
    f.clock.tick(1000);
    assert.equal(shutter.current.value, automatic ? 50 : 49);
    assert.equal(shutter.state.value, hap.Characteristic.PositionState.DECREASING);
    assert.equal(f.clock.pending, 2);
  });
}


test('a downward target crossed before writing yields to a newer pending target', async t => {
  const f = device(t, { upSeconds: 100, downSeconds: 100 });
  const shutter = await ready(f);
  await set(shutter.target, 0);
  f.clock.tick(5000);
  assert.equal(shutter.current.value, 45);
  f.rfy.autoWrite = f.rfy.autoAck = false;
  const superseded = assert.rejects(set(shutter.target, 44));
  const latest = set(shutter.target, 60);
  f.clock.tick(2000);
  assert.equal(shutter.current.value, 43);
  f.rfy.sent[1].write();
  f.rfy.autoWrite = f.rfy.autoAck = true;
  f.rfy.sent[1].ack();
  await Promise.all([superseded, latest]);
  assert.deepEqual(f.rfy.calls.map(call => call[0]), ['down', 'down', 'up']);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.INCREASING);
  f.clock.tick(17000);
  assert.equal(shutter.current.value, 60);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
  assert.equal(f.clock.pending, 0);
});
