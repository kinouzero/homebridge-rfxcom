const rfxcom = require('rfxcom');

const PLUGIN_ID          = 'homebridge-rfxcom';
const PLUGIN_NAME        = 'RFXCom';
const TTY                = '/dev/ttyUSB0';
const OPEN_CLOSE_SECONDS = 25;
const OPEN_CLOSE_DEFAULT = true;
const DIRECTION          = {
  up   : 'Up',
  down : 'Down',
  stop : 'Stop'
}
const MODE               = {
  switch: 'switch',
  target: 'target'
}

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  Accessory      = homebridge.platformAccessory;
  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen        = homebridge.hap.uuid;

  homebridge.registerPlatform(PLUGIN_ID, PLUGIN_NAME, RFXComPlatform, true);
}

// Constructor
function RFXComPlatform(log, config, api) {
  this.log    = log;
  this.config = config || { platform: PLUGIN_NAME };
  this.tty    = this.config.tty || TTY;
  this.debug  = this.config.debug || false;

  this.openCloseDefault = this.config.openCloseDefault || OPEN_CLOSE_DEFAULT;

  const rfyRemotes = this.config.rfyRemotes || this.config.rfyremotes;
  this.rfyRemotes  = Array.isArray(rfyRemotes) ? rfyRemotes : [];

  this.accessories = {};

  this.rfxtrx = new rfxcom.RfxCom(this.tty, { debug: this.debug });
  this.rfy    = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY);

  this.rfxtrx.on('disconnect', () => this.log('ERROR: RFXtrx disconnect'));
  this.rfxtrx.on('connectfailed', () => this.log('ERROR: RFXtrx connect fail'));

  if(api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  }
}

// Setup accesories from config.json
RFXComPlatform.prototype.didFinishLaunching = function() {
  // Add or update accessory in HomeKit
  if(this.rfyRemotes.length) {
    // Compare local config against RFXCom-registered remotes
    this.listRemotes()
      .then(deviceRemotes => {
        if(this.debug) this.log(`Received ${deviceRemotes.length} remote(s) from device`);

        this.rfyRemotes.forEach(remote => {
          // Handle different capitalizations of deviceID
          remote.deviceID = remote.deviceID || remote.deviceId;
          const deviceID  = remote.deviceID;
          const device    = deviceRemotes.find(dR => deviceID === dR.deviceId);

          if(device) {
            // Remote found on the RFXCom device
            this.addRemote(remote, device);
            if(this.debug) this.log(`Added accessories for RFY remote ${remote.deviceID}`);
          } else {
            // No remote found on device
            const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
            if(this.debug) this.log(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
          }
        })
      })
      .catch(err => {
        this.log(`UNHANDLED ERROR : ${err}`);
        if(this.debug) console.log(err.stack);
      })
  } else {
    this.log(`WARN: No RFY remotes configured`);
    this.removeAccessories();
  }
}

// Accessory
RFXComPlatform.prototype.configureAccessory = function(accessory) {
  if(!accessory) return;

  let id = accessory.context.switchID || accessory.context.shutterID;

  if(this.debug) this.log(`Loaded from cache: ${accessory.context.name} (${id})`);

  const existing = this.accessories[id];
  if(existing) this.removeAccessory(existing);

  this.accessories[id] = accessory;
}

RFXComPlatform.prototype.removeAccessory = function(accessory) {
  if(!accessory) return;

  const id = accessory.context.switchID || accessory.context.shutterID;
  this.log(`${accessory.context.name} (${id}) removed from HomeBridge.`);
  this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
  delete this.accessories[id];
}

RFXComPlatform.prototype.removeAccessories = function() {
  this.accessories.forEach(id => this.removeAccessory(this.accessories[id]));
}

// Remote
RFXComPlatform.prototype.listRemotes = function() {
  return new Promise((resolve, reject) => {
    this.rfxtrx.once('rfyremoteslist', remotes => resolve(remotes));

    this.rfxtrx.initialise(() => {
      if(this.debug) this.log('RFXtrx initialized, listing remotes...');
      this.rfy.listRemotes();
    })
  })
}

RFXComPlatform.prototype.addRemote = function(remote, device) {
  if(!remote || !device) return;

  remote.switches = {};
  remote.shutter  = null ;

  this.addSwitch(remote, device, DIRECTION.up);
  this.addSwitch(remote, device, DIRECTION.down);
  this.addShutter(remote, device);
}

RFXComPlatform.prototype.initRemote = function(remote, type) {
  this.log(`RFY ${type} ${remote.deviceID}`);

  // Set shutter position state
  this.setShutterPositionState(remote, type === DIRECTION.up ? Characteristic.PositionState.INCREASING : Characteristic.PositionState.DECREASING);

  // Toggle all switches to the correct on/off state
  for(const t in remote.switches) this.setSwitch(remote.switches[t], t === type);

  // After a configurable amount of time, toggle the switch back to off
  this.resetSwitch(remote);

  // Start remote
  this.startRemote(remote);
}

RFXComPlatform.prototype.startRemote = function(remote) {
  if(!remote || !(_shutter = remote.shutter) || !(_switch = remote.switches[_shutter.context.direction]) ||
    (_shutter.context.direction === DIRECTION.up && _shutter.context.currentPosition === 100) ||
    (_shutter.context.direction === DIRECTION.down && _shutter.context.currentPosition === 0))
      return;

  // Up
  if(_shutter.context.direction === DIRECTION.up) this.rfy.up(remote.deviceID);
  // Down
  if(_shutter.context.direction === DIRECTION.down) this.rfy.down(remote.deviceID);

  // Start update remote
  _shutter.context.interval = setInterval(() => this.updateRemote(remote), 1000);

  if(this.debug) this.log(`Starting remote ${_shutter.context.shutterID}, currentPosition=${_shutter.context.currentPosition}`);
}

RFXComPlatform.prototype.updateRemote = function(remote, value = null) {
  if(!remote || !(_shutter = remote.shutter)) return;

  let percent = 0, stop = false, log = '';

  // Increase duration
  _shutter.context.duration++;

  // Set forced value
  if(value !== null) _shutter.context.processPosition = value;
  else {
    // Calcul percentage overture
    if(_shutter.context.duration > 0) percent = Math.round((_shutter.context.duration * 100) / _shutter.context.totalDuration);
    if(percent > 0 && _shutter.context.direction === DIRECTION.up) _shutter.context.processPosition = _shutter.context.currentPosition + percent;
    if(percent > 0 && _shutter.context.direction === DIRECTION.down) _shutter.context.processPosition = _shutter.context.currentPosition - percent;
    if(percent > 100 || percent < 0) this.stopRemote(remote, true);
    log = `, movedBy=${percent}%`;
  }

  if(this.debug) this.log(`Updating remote ${_shutter.context.shutterID}, direction=${_shutter.context.direction}, currentPosition=${_shutter.context.currentPosition}, processPosition=${_shutter.context.processPosition}${log}`);

  // Stop by target
  if(_shutter.context.mode === MODE.target && (
    (_shutter.context.direction === DIRECTION.up && _shutter.context.processPosition >= _shutter.context.targetPosition) ||
    (_shutter.context.direction === DIRECTION.down && _shutter.context.processPosition <= _shutter.context.targetPosition)))
      this.stopRemote(remote)

  // Stop by position
  if(value === null && (_shutter.context.processPosition > 100 || _shutter.context.processPosition < 0)) {
    if(_shutter.context.processPosition > 100) _shutter.context.processPosition = 100;
    else if(_shutter.context.processPosition < 0) _shutter.context.processPosition = 0;
    this.stopRemote(remote, true)
  }

  // Stop by duration
  if(_shutter.context.duration > _shutter.context.totalDuration) this.stopRemote(remote, true)
}

RFXComPlatform.prototype.stopRemote = function(remote, force = false) {
  if(!remote || !(_shutter = remote.shutter) || _shutter.context.direction === DIRECTION.stop) return;

  // Stop update remote
  clearInterval(_shutter.context.interval);

  // Set switch
  let _switch;
  if(_switch = remote.switches[_shutter.context.direction]) this.setSwitch(_switch, false);

  // Set shutter
  this.updateRemote(remote, force ? (_shutter.context.direction === DIRECTION.up ? 100 : 0) : null);
  this.setShutterPositionState(remote);
  this.setShutterTargetPosition(_shutter, _shutter.context.processPosition);
  this.setShutterCurrentPosition(_shutter, _shutter.context.processPosition);

  // Stop
  if(_shutter.context.processPosition < 100 && _shutter.context.processPosition > 0) this.rfy.stop(remote.deviceID);

  // Reset context
  _shutter.context.direction = DIRECTION.stop;
  _shutter.context.duration  = 0;
  _shutter.context.mode      = MODE.switch;

  if(this.debug) this.log(`Stopping remote ${_shutter.context.shutterID}, currentPosition=${_shutter.context.currentPosition}`);
}

// Switch
RFXComPlatform.prototype.addSwitch = function(remote, device, type) {
  if(!remote || !device || !type) return;

  const deviceID = remote.deviceID;
  const switchID = `${deviceID}/${type}`;

  this.log(`Adding switch ${switchID}`);

  // Setup accessory
  let _switch = this.accessories[switchID];
  if(_switch) this.removeAccessory(_switch);

  const name = `${remote.name} ${type}`;
  const uuid = UUIDGen.generate(switchID);
  _switch  = new Accessory(remote.name, uuid);

  this.accessories[switchID] = _switch;

  _switch.context = {
    deviceID : deviceID,
    switchID : switchID,
    name     : name,
    device   : device,
    isOn     : false,
    timeout  : null
  }

  remote.switches[type] = _switch;

  // Setup HomeKit service
  _switch.addService(Service.Switch, name);

  // New switch is always reachable
  _switch.reachable = true;
  _switch.updateReachability(true);

  // Setup HomeKit switch information
  _switch
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, PLUGIN_NAME)
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${deviceID}-${device.unitCode}-${type}`);

  // Setup event listeners
  _switch
    .on('identify', (paired, callback) => {
      if(this.debug) this.log(`${name} identify requested, paired=${paired}`);
      callback();
    })
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('get', callback => callback(null, _switch.context.isOn))
    .on('set', (value, callback) => {
      // Stop if toggled off
      if(!value) {
        this.stopRemote(remote);

        return callback();
      }

      // Init remote
      this.initRemote(remote, type)

      callback();
    });

  // Register new switch in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [_switch]);

  // Set the initial switch position
  this.setSwitch(_switch, _switch.context.isOn);

  return _switch;
}

RFXComPlatform.prototype.setSwitch = function(_switch, isOn) {
  if(!_switch) return;

  _switch.context.isOn = isOn
  _switch
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .getValue();

  if(this.debug) this.log(`Set switch ${_switch.context.switchID}, on=${_switch.context.isOn}`);
}

RFXComPlatform.prototype.resetSwitch = function(remote) {
  if(!remote || !(_shutter = remote.shutter) || !(_switch = remote.switches[_shutter.context.direction])) return;

  clearTimeout(_switch.context.timeout)
  _switch.context.timeout = setTimeout(() => {
    this.stopRemote(remote, true);
  }, _shutter.context.totalDuration * 1000);
}

// Shutter
RFXComPlatform.prototype.addShutter = function(remote, device) {
  if(!remote || !device) return;

  const deviceID  = remote.deviceID;
  const shutterID = `${deviceID}/Shutter`;

  this.log(`Adding shutter ${shutterID}`);

  // Setup accessory
  let _shutter = this.accessories[shutterID];
  if(_shutter) this.removeAccessory(_shutter);

  const name = `${remote.name} Shutter`;
  const uuid = UUIDGen.generate(shutterID);
  _shutter   = new Accessory(remote.name, uuid);

  this.accessories[shutterID] = _shutter;

  _shutter.context = {
    deviceID        : deviceID,
    shutterID       : shutterID,
    name            : name,
    device          : device,
    positionState   : Characteristic.PositionState.STOPPED,
    processPosition : 0,
    currentPosition : this.openCloseDefault ? 100 : 0,
    targetPosition  : this.openCloseDefault ? 100 : 0,
    interval        : null,
    duration        : 0,
    totalDuration   : this.openCloseSeconds ? this.openCloseSeconds : OPEN_CLOSE_SECONDS,
    direction       : DIRECTION.stop,
    mode            : MODE.switch
  };

  remote.shutter = _shutter;

  // Setup HomeKit service
  _shutter.addService(Service.WindowCovering, name);

  // New shutter is always reachable
  _shutter.reachable = true;
  _shutter.updateReachability(true);

  // Setup HomeKit shutter information
  _shutter
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, PLUGIN_NAME)
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${deviceID}-${device.unitCode}-Shutter`);

  // Setup event listeners
  _shutter
    .on('identify', (paired, callback) => {
      if(this.debug) this.log(`${name} identify requested, paired=${paired}`);
      callback();
    })
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.PositionState)
    .on('get', callback => callback(null, _shutter.context.positionState));

  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.CurrentPosition)
    .on('get', callback => callback(null, _shutter.context.currentPosition));

  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.TargetPosition)
    .on('get', callback => callback(null, _shutter.context.targetPosition))
    .on('set', (value, callback) => {
      /** @todo : WIP to make shutter placeholder interactive  **/
      if(_shutter.context.targetPosition === value) return callback();
      
      // Set target position
      this.setShutterTargetPosition(_shutter, value);
      if(_shutter.context.targetPosition === _shutter.context.currentPosition) return callback();
      
      if(this.debug) this.log(`Updating shutter ${_shutter.context.shutterID}, currrentPosition=${_shutter.context.currentPosition}, targetPosition=${value}`);
      // Set context
      _shutter.context.mode = MODE.target;
      
      // Init remote
      let type = _shutter.context.targetPosition > _shutter.context.currentPosition ? DIRECTION.up : DIRECTION.down;
      this.initRemote(remote, type);

      callback();
    });

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [_shutter]);

  // Set the initial shutter positions
  this.updateRemote(remote, _shutter.context.processPosition);
  this.setShutterCurrentPosition(_shutter, _shutter.context.currentPosition);
  this.setShutterTargetPosition(_shutter, _shutter.context.targetPosition);
  this.setShutterPositionState(remote);

  return _shutter;
}

RFXComPlatform.prototype.setShutterCurrentPosition = function(_shutter, value) {
  if(!_shutter) return;

  if(this.debug) this.log(`Set shutter ${_shutter.context.shutterID}, currentPosition=${value}`);

  _shutter.context.currentPosition = value;
  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.CurrentPosition)
    .getValue();
}

RFXComPlatform.prototype.setShutterTargetPosition = function(_shutter, value) {
  if(!_shutter) return;

  if(this.debug) this.log(`Set shutter ${_shutter.context.shutterID}, targetPosition=${value}`);

  _shutter.context.targetPosition = value;
  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.TargetPosition)
    .getValue();
}

RFXComPlatform.prototype.setShutterPositionState = function(remote, positionState = Characteristic.PositionState.STOPPED) {
  if(!remote || !(_shutter = remote.shutter)) return;

  if(this.debug) this.log(`Set shutter ${_shutter.context.shutterID}, positionState=${_shutter.context.positionState}`);

  _shutter.context.direction     = positionState === Characteristic.PositionState.INCREASING ? DIRECTION.up : DIRECTION.down;
  _shutter.context.positionState = positionState;
  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.PositionState)
    .getValue();
}