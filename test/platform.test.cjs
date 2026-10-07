const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ready, flush, cached, set, PLUGIN_NAME, PLATFORM_NAME, hap, Radio } = require('./helpers.cjs');
const { DISCOVERY_TIMEOUT_MS, RECONNECT_INITIAL_MS, RECONNECT_MAX_MS, TTY } = require('../dist/settings');
const remote = { name: 'Salon', deviceID: '0x123/1' };

test('entry registers the existing Homebridge platform', () => {
  let registration;
  require('../dist/index')({ registerPlatform: (...args) => { registration = args; } });
  assert.equal(registration[0], PLATFORM_NAME);
  assert.equal(typeof registration[1], 'function');
});
test('launch discovers one WindowCovering per configured device', async t => {
  const f = fixture(t, { rfyRemotes: [remote], tty: '/dev/custom', debug: true });
  f.api.emit('didFinishLaunching');
  await flush();
  assert.equal(f.radio.device, '/dev/custom');
  assert.deepEqual(f.radio.options, { debug: true });
  assert.equal(f.api.registered.length, 1);
  assert.deepEqual(f.api.registered[0].slice(0, 2), [PLUGIN_NAME, PLATFORM_NAME]);
  assert.equal(Object.keys(f.platform.accessories).length, 1);
  assert.equal(Object.values(f.platform.accessories)[0].getService(hap.Service.Switch), undefined);
});
test('empty configuration removes cached devices without starting a radio', async t => {
  const f = fixture(t, {});
  cached(f, '0x123/1');
  await ready(f);
  assert.equal(f.radio.device, TTY);
  assert.equal(f.radio.initCount, 0);
  assert.equal(f.api.removed.length, 1);
  assert.deepEqual(f.api.removed[0].slice(0, 2), [PLUGIN_NAME, PLATFORM_NAME]);
  assert.equal(f.clock.pending, 0);
});
test('v2 configuration is normalized once without mutating the input', async t => {
  const entry = Object.freeze({ ...remote });
  const f = fixture(t, { rfyRemotes: [entry] });
  await ready(f);
  assert.equal(f.api.registered.length, 1);
  assert.deepEqual(entry, remote);
  assert.deepEqual(f.platform.remotes[0], { ...remote, upSeconds: 25, downSeconds: 25, reverse: false });
  assert.equal(Object.isFrozen(f.platform.remotes[0]), true);
});
for (const config of [
  { RfyRemotes: [remote] },
  { rfyRemotes: [{ name: 'Salon', deviceId: remote.deviceID }] },
  { rfyRemotes: [{ ...remote, openCloseSeconds: 60 }] },
  { rfyRemotes: [{ ...remote, unsupportedOption: true }] },
]) {
  test('unsupported configuration cannot create a device: ' + JSON.stringify(config), async t => {
    const f = fixture(t, config);
    await ready(f);
    assert.equal(f.platform.remotes.length, 0);
    assert.equal(f.api.registered.length, 0);
    assert.equal(f.radio.initCount, 0);
  });
}
test('invalid IDs, empty names and duplicate remotes are ignored', t => {
  const entries = [null, {}, { ...remote, deviceID: '0x000000/1' }, { ...remote, deviceID: '0x100000/1' },
    { ...remote, deviceID: '0x123/5' }, { ...remote, name: ' ' }, remote, remote];
  const f = fixture(t, { rfyRemotes: entries });
  assert.equal(f.platform.remotes.length, 1);
  assert.equal(f.logs.filter(([level]) => level === 'warn').length, 7);
});
test('configured names and v2 UUIDs survive cache restoration and unrelated accessories are pruned', async t => {
  const f = fixture(t, { rfyRemotes: [{ ...remote, name: 'Chambre' }] });
  const accessory = cached(f, '0x123/1', 23.4);
  const uuid = accessory.UUID;
  cached(f, 'unused-a');
  cached(f, 'unused-b');
  const shutter = await ready(f);
  assert.equal(shutter.accessory, accessory);
  assert.equal(accessory.UUID, uuid);
  assert.equal(accessory.context.current, 23.4);
  assert.equal(accessory.displayName, 'Chambre');
  assert.equal(shutter.current.value, 23);
  assert.equal(accessory.getService(hap.Service.WindowCovering).getCharacteristic(hap.Characteristic.Name).value, 'Chambre');
  assert.equal(f.api.registered.length, 0);
  assert.equal(f.api.updated.length, 1);
  assert.equal(f.api.removed.length, 2);
});
test('unconfigured accessories are removed even when USB discovery fails', async t => {
  const f = fixture(t);
  const accessory = cached(f, '0x123/1');
  cached(f, 'unused-a');
  cached(f, 'unused-b');
  f.radio.initError = new Error('USB unavailable');
  await ready(f);
  assert.equal(f.api.removed.length, 2);
  assert.equal(f.platform.accessories[accessory.UUID], accessory);
  await assert.rejects(f.platform.shutter[remote.deviceID].current.handleGetRequest());
  assert.equal(f.clock.pending, 1);
});
test('cache entries are identified only by UUID', async t => {
  const f = fixture(t);
  const orphan = new f.api.platformAccessory('Old', hap.uuid.generate('orphan'));
  f.platform.configureAccessory(orphan);
  await ready(f);
  assert.equal(f.platform.accessories[orphan.UUID], undefined);
  assert.deepEqual(f.api.removed, [[PLUGIN_NAME, PLATFORM_NAME, [orphan]]]);
});
test('missing configured remote remains cached and unavailable in HomeKit', async t => {
  const f = fixture(t);
  const accessory = cached(f, '0x123/1');
  f.radio.remotes = [];
  await ready(f);
  assert.equal(f.platform.accessories[accessory.UUID], accessory);
  assert.equal(f.api.removed.length, 0);
  await assert.rejects(f.platform.shutter[remote.deviceID].current.handleGetRequest());
});
test('concurrent listing calls share one discovery and clean listeners', async t => {
  const f = fixture(t);
  f.radio.autoList = false;
  const first = f.platform.listRemotes();
  assert.equal(f.platform.listRemotes(), first);
  f.radio.emit('rfyremoteslist', []);
  assert.deepEqual(await first, []);
  assert.equal(f.radio.initCount, 1);
  assert.equal(f.radio.listenerCount('rfyremoteslist'), 0);
  assert.equal(f.clock.pending, 0);
});
test('repeated discovery reuses both the connection and active shutter instance', async t => {
  const f = fixture(t);
  const shutter = await ready(f);
  await set(shutter.target, 100);
  const again = await ready(f);
  assert.equal(again, shutter);
  assert.equal(f.radio.initCount, 1);
  assert.equal(shutter.state.value, hap.Characteristic.PositionState.INCREASING);
  assert.equal(shutter.target.listenerCount('set'), 1);
});
for (const event of ['disconnect', 'connectfailed']) {
  test(event + ' freezes movement, fails HomeKit reads and writes, then reconnects without replay', async t => {
    const f = fixture(t);
    const shutter = await ready(f);
    await set(shutter.target, 100);
    f.clock.tick(1000);
    const old = f.radio;
    old.emit(event, new Error('USB lost'));
    assert.equal(f.platform.online, false);
    assert.equal(shutter.current.value, 54);
    assert.equal(shutter.state.value, hap.Characteristic.PositionState.STOPPED);
    await assert.rejects(shutter.current.handleGetRequest());
    await assert.rejects(set(shutter.target, 0));
    assert.equal(f.clock.pending, 1);
    f.clock.tick(RECONNECT_INITIAL_MS);
    await flush();
    assert.notEqual(f.radio, old);
    assert.equal(f.platform.online, true);
    assert.equal(await shutter.current.handleGetRequest(), 54);
    assert.equal(f.rfy.calls.length, 0);
    assert.equal(f.api.registered.length, 1);
    assert.equal(f.clock.pending, 0);
    old.emit('disconnect');
    assert.equal(f.platform.online, true);
  });
}
test('reconnection backs off to a maximum and resets after successful discovery', async t => {
  const f = fixture(t);
  await ready(f);
  Radio.configure = radio => { radio.initError = new Error('Still unplugged'); };
  f.radio.emit('disconnect');
  for (const delay of [5000, 10000, 20000, 40000, RECONNECT_MAX_MS]) {
    const old = f.radio;
    f.clock.tick(delay - 1);
    assert.equal(f.radio, old);
    f.clock.tick(1);
    await flush();
    assert.notEqual(f.radio, old);
    assert.equal(f.clock.pending, 1);
  }
  Radio.configure = undefined;
  f.clock.tick(RECONNECT_MAX_MS);
  await flush();
  assert.equal(f.platform.online, true);
  f.radio.emit('disconnect');
  const old = f.radio;
  f.clock.tick(RECONNECT_INITIAL_MS);
  await flush();
  assert.notEqual(f.radio, old);
  assert.equal(f.platform.online, true);
});
test('discovery timeout closes the connection and ignores late initialization', async t => {
  const f = fixture(t);
  f.radio.deferInit = true;
  const old = f.radio;
  const discovery = f.platform.discoverRemotes();
  f.clock.tick(DISCOVERY_TIMEOUT_MS);
  await discovery;
  old.ready();
  assert.equal(old.rfy.listCount, 0);
  assert.equal(old.closeCount, 1);
  assert.equal(old.listenerCount('rfyremoteslist'), 0);
  assert.equal(f.clock.pending, 1);
});
for (const mode of ['initError', 'listError', 'listCallbackError', 'listBusy']) {
  test('discovery recovers after ' + mode, async t => {
    const f = fixture(t);
    if (mode === 'initError') f.radio.initError = new Error(mode);
    else if (mode === 'listBusy') {
      f.radio.autoList = false;
      f.rfy.listResult = -1;
    } else f.rfy[mode] = new Error(mode);
    await ready(f);
    assert.equal(f.platform.online, false);
    assert.equal(f.clock.pending, 1);
    f.clock.tick(RECONNECT_INITIAL_MS);
    await flush();
    assert.equal(f.platform.online, true);
    assert.equal(f.api.registered.length, 1);
  });
}
test('shutdown cancels discovery, reconnection and late responses', async t => {
  const f = fixture(t);
  f.radio.autoList = false;
  const discovery = f.platform.discoverRemotes();
  f.api.emit('shutdown');
  await discovery;
  f.radio.emit('rfyremoteslist', f.radio.remotes);
  f.clock.tick(RECONNECT_MAX_MS);
  assert.equal(f.api.registered.length, 0);
  assert.equal(f.clock.pending, 0);
  assert.equal(f.radio.listenerCount('response'), 0);
  await assert.rejects(f.platform.listRemotes(), /unavailable/);
  f.platform.shutdown();
  assert.equal(f.radio.closeCount, 1);
});
test('shutdown after the response prevents accessory registration', async t => {
  const f = fixture(t);
  const discovery = f.platform.discoverRemotes();
  f.platform.shutdown();
  await discovery;
  assert.equal(f.api.registered.length, 0);
  assert.equal(f.clock.pending, 0);
});
test('removing an active accessory cancels its estimate without deleting another device', async t => {
  const f = fixture(t, { rfyRemotes: [remote, { ...remote, deviceID: '0x124/1' }] });
  f.radio.remotes.push({ deviceId: '0x124/1' });
  await ready(f);
  const first = f.platform.shutter['0x123/1'];
  const second = f.platform.shutter['0x124/1'];
  await set(first.target, 100);
  await set(second.target, 100);
  f.clock.tick(1000);
  f.platform.removeAccessory(first.accessory);
  assert.equal(f.platform.shutter['0x123/1'], undefined);
  assert.equal(f.platform.shutter['0x124/1'], second);
  assert.equal(f.clock.pending, 2);
  f.clock.tick(20000);
  assert.equal(first.current.value, 54);
  assert.equal(second.current.value, 100);
});

test('a negative discovery response closes the connection and schedules retry immediately', async t => {
  const f = fixture(t);
  f.radio.autoList = false;
  const discovery = f.platform.discoverRemotes();
  const sequence = f.radio.sequence - 1;
  f.radio.respond(sequence + 1, 4);
  assert.equal(f.platform.online, true);
  f.radio.respond(sequence, 4);
  await discovery;
  assert.equal(f.platform.online, false);
  assert.equal(f.radio.closeCount, 1);
  assert.equal(f.clock.pending, 1);
  assert.ok(f.logs.some(([level, message]) => level === 'error' && message.includes('code 4')));
});

test('repeated disconnect events do not create multiple retries and shutdown cancels the retry', async t => {
  const f = fixture(t);
  await ready(f);
  f.radio.emit('disconnect');
  f.radio.emit('connectfailed');
  assert.equal(f.radio.closeCount, 1);
  assert.equal(f.clock.pending, 1);
  const old = f.radio;
  f.platform.shutdown();
  f.clock.tick(RECONNECT_MAX_MS);
  assert.equal(f.radio, old);
  assert.equal(f.clock.pending, 0);
});


test('disconnect during discovery cancels it once and ignores queued list callbacks', async t => {
  const f = fixture(t);
  f.radio.autoList = false;
  const discovery = f.platform.discoverRemotes();
  const onRemotes = f.radio.listeners('rfyremoteslist')[0];
  f.radio.emit('disconnect');
  onRemotes(f.radio.remotes);
  f.rfy.listCallback(new Error('Late list failure'));
  await discovery;
  assert.equal(f.platform.online, false);
  assert.equal(f.api.registered.length, 0);
  assert.equal(f.radio.closeCount, 1);
  assert.equal(f.radio.listenerCount('rfyremoteslist'), 0);
  assert.equal(f.clock.pending, 1);
});

test('a discovery failure callback without an error still rejects and cleans up', async t => {
  const f = fixture(t);
  f.radio.autoList = false;
  const discovery = assert.rejects(f.platform.listRemotes(), /connection failed or disconnected/);
  const onFailure = f.radio.listeners('connectfailed').at(-1);
  onFailure();
  await discovery;
  assert.equal(f.radio.listenerCount('rfyremoteslist'), 0);
  assert.equal(f.clock.pending, 0);
});

test('shutdown prevents an already dispatched retry and subsequent discovery from reopening USB', async t => {
  const f = fixture(t);
  await ready(f);
  f.radio.emit('disconnect');
  // A cancelled callback may already have been handed to the scheduler.
  const retry = [...f.clock.timers].find(([id, timer]) => id.refed && timer.at === f.clock.now + RECONNECT_INITIAL_MS)[1].fn;
  const radio = f.radio;
  f.platform.shutdown();
  retry();
  await f.platform.discoverRemotes();
  assert.equal(f.radio, radio);
  assert.equal(f.radio.initCount, 1);
  assert.equal(f.api.registered.length, 1);
  assert.equal(f.clock.pending, 0);
});


test('an undiscovered device without a cached accessory stays unregistered', async t => {
  const f = fixture(t);
  f.radio.remotes = [];
  await ready(f);
  assert.equal(f.api.registered.length, 0);
  assert.equal(Object.keys(f.platform.shutter).length, 0);
  assert.ok(f.logs.some(([level, message]) => level === 'warn' && message.includes('not found')));
});


test('v1 accessory identities and positions are not migrated into v2', async t => {
  const f = fixture(t);
  const old = cached(f, '0x123/1/Shutter', 12.5);
  old.context.id = '0x123/1/Shutter';
  const shutter = await ready(f);
  assert.notEqual(shutter.accessory.UUID, old.UUID);
  assert.equal(shutter.accessory.UUID, hap.uuid.generate(remote.deviceID));
  assert.equal(shutter.current.value, 50);
  assert.deepEqual(f.api.removed, [[PLUGIN_NAME, PLATFORM_NAME, [old]]]);
  assert.equal(f.api.registered.length, 1);
  assert.deepEqual(shutter.accessory.context, { current: 50, reverse: false });
  const information = shutter.accessory.getService(hap.Service.AccessoryInformation);
  assert.equal(information.getCharacteristic(hap.Characteristic.SerialNumber).value, remote.deviceID);
});

test('unknown cache metadata cannot redirect a device to another UUID', async t => {
  const f = fixture(t);
  const orphan = new f.api.platformAccessory('Orphan', hap.uuid.generate('unconfigured-device'));
  orphan.context = { id: remote.deviceID, current: 90, reverse: false };
  f.platform.configureAccessory(orphan);
  const shutter = await ready(f);
  assert.notEqual(shutter.accessory, orphan);
  assert.equal(shutter.current.value, 50);
  assert.deepEqual(f.api.removed, [[PLUGIN_NAME, PLATFORM_NAME, [orphan]]]);
});
