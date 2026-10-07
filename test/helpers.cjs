const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { dirname, join } = require('node:path');
// Use Homebridge 2's own API and HAP implementation in the tests.
// Runtime plugin code only uses the API instance supplied by Homebridge.
const { HomebridgeAPI } = require(join(dirname(require.resolve('homebridge')), 'api.js'));
const { hap, platformAccessory: PlatformAccessory } = new HomebridgeAPI();

class Radio extends EventEmitter {
  static instances = [];
  constructor(device, options) {
    super();
    Radio.latest = this;
    Radio.instances.push(this);
    this.device = device;
    this.options = options;
    this.remotes = [{ deviceId: '0x123/1' }];
    this.autoList = true;
    this.initCount = 0;
    this.closeCount = 0;
    this.sequence = 0;
    Radio.configure?.(this);
  }
  initialise(callback) {
    this.initCount++;
    if (this.initError) throw this.initError;
    this.ready = callback;
    if (!this.deferInit) callback();
  }
  close() { this.closeCount++; }
  respond(sequence, code = 0) {
    this.emit('response', 'Response ' + code, sequence, code);
  }
}
class Rfy {
  constructor(radio) {
    this.radio = radio;
    radio.rfy = this;
    this.calls = [];
    this.sent = [];
    this.listCount = 0;
    this.autoWrite = true;
    this.autoAck = true;
  }
  listRemotes(callback) {
    this.listCount++;
    this.listCallback = callback;
    if (this.listError) throw this.listError;
    callback?.(this.listCallbackError);
    if (this.radio.autoList) this.radio.emit('rfyremoteslist', this.radio.remotes);
    return this.listResult ?? this.radio.sequence++ % 256;
  }
  command(name, id, callback) {
    this.calls.push([name, id]);
    if (this.throwError) throw this.throwError;
    const sequence = this.radio.sequence++ % 256;
    const item = {
      name, id, sequence,
      write: (error = this.writeError) => callback?.(error, undefined, sequence),
      ack: (code = this.ackCode ?? 0) => this.radio.respond(sequence, code),
    };
    this.sent.push(item);
    if (this.autoWrite) item.write();
    if (this.autoAck) item.ack();
    return this.sequenceResult ?? sequence;
  }
  up(id, callback) { return this.command('up', id, callback); }
  down(id, callback) { return this.command('down', id, callback); }
  stop(id, callback) { return this.command('stop', id, callback); }
}
const rfxPath = require.resolve('rfxcom');
require.cache[rfxPath] = { id: rfxPath, filename: rfxPath, loaded: true, exports: { RfxCom: Radio, Rfy, rfy: { RFY: 0 } } };
const { RFXComPlatform } = require('../dist/platform');
const { PLUGIN_NAME, PLATFORM_NAME } = require('../dist/settings');

class Clock {
  constructor() {
    this.now = 0;
    this.next = 0;
    this.timers = new Map();
    this.original = { setTimeout, clearTimeout, setInterval, clearInterval };
    this.nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const add = (fn, delay, repeat) => {
      const id = { refed: true, unref() { this.refed = false; return this; }, ref() { this.refed = true; return this; } };
      this.timers.set(id, { fn, at: this.now + delay, repeat });
      return id;
    };
    global.setTimeout = (fn, ms) => add(fn, ms, 0);
    global.setInterval = (fn, ms) => add(fn, ms, ms);
    global.clearTimeout = global.clearInterval = id => this.timers.delete(id);
    Object.defineProperty(performance, 'now', { configurable: true, value: () => this.now });
  }
  tick(ms, delayed = false) {
    const end = this.now + ms;
    if (delayed) this.now = end;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      if (!delayed) this.now = timer.at;
      if (timer.repeat) timer.at = this.now + timer.repeat;
      else this.timers.delete(id);
      timer.fn();
    }
    this.now = end;
  }
  get pending() { return [...this.timers.keys()].filter(id => id.refed).length; }
  restore() {
    Object.assign(global, this.original);
    if (this.nowDescriptor) Object.defineProperty(performance, 'now', this.nowDescriptor);
    else delete performance.now;
  }
}

function fixture(t, config = { rfyRemotes: [{ name: 'Salon', deviceID: '0x123/1' }] }) {
  const api = new HomebridgeAPI();
  api.hap = hap;
  api.platformAccessory = PlatformAccessory;
  api.registered = [];
  api.updated = [];
  api.removed = [];
  api.registerPlatformAccessories = (...args) => api.registered.push(args);
  api.updatePlatformAccessories = accessories => api.updated.push(accessories);
  api.unregisterPlatformAccessories = (...args) => api.removed.push(args);
  const logs = [];
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => logs.push([level, ...args])]));
  const platform = new RFXComPlatform(log, config === undefined ? undefined : { platform: PLATFORM_NAME, ...config }, api);
  const clock = new Clock();
  t.after(() => { platform.shutdown(); clock.restore(); Radio.configure = undefined; });
  return { api, platform, get radio() { return Radio.latest; }, get rfy() { return Radio.latest.rfy; }, clock, logs };
}
async function ready(f) {
  await f.platform.discoverRemotes();
  return Object.values(f.platform.shutter)[0];
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function cached(f, id, current = 30, reverse = false) {
  const accessory = new PlatformAccessory('Cached', hap.uuid.generate(id));
  accessory.context = { current, reverse };
  f.platform.configureAccessory(accessory);
  return accessory;
}
function set(characteristic, value) {
  return new Promise((resolve, reject) => {
    characteristic.setValue(value, error => error ? reject(error) : resolve());
  });
}
module.exports = { fixture, ready, flush, cached, set, PLUGIN_NAME, PLATFORM_NAME, hap, Radio, Rfy, Clock };
