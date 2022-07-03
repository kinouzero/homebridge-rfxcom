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

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  Accessory      = homebridge.platformAccessory;
  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen        = homebridge.hap.uuid;

  homebridge.registerPlatform(PLUGIN_ID, PLUGIN_NAME, RFXComPlatform, true);
}

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

// Method to restore accessories from cache
RFXComPlatform.prototype.configureAccessory = function(accessory) {
  if(!accessory) return;

  let id = accessory.context.switchID || accessory.context.shutterID;

  if(this.debug) this.log(`Loaded from cache: ${accessory.context.name} (${id})`);

  const existing = this.accessories[id];
  if(existing) this.removeAccessory(existing);

  this.accessories[id] = accessory;
}

// Method to setup accesories from config.json
RFXComPlatform.prototype.didFinishLaunching = function() {
  // Add or update accessory in HomeKit
  if(this.rfyRemotes.length) {
    // Compare local config against RFXCom-registered remotes
    this.listRFYRemotes()
      .then(deviceRemotes => {
        if(this.debug) this.log(`Received ${deviceRemotes.length} remote(s) from device`);

        this.rfyRemotes.forEach(remote => {
          // Handle different capitalizations of deviceID
          remote.deviceID = remote.deviceID || remote.deviceId;
          const deviceID  = remote.deviceID;
          const device    = deviceRemotes.find(dR => deviceID === dR.deviceId);

          if(device) {
            // Remote found on the RFXCom device
            this.addRFYRemote(remote, device);
            if(this.debug) this.log(`Added accessories for RFY remote ${remote.deviceID}`);
          } else {
            // No remote found on device
            const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
            if(this.debug) this.log(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
          }
        })
      })
      .catch(err => {
        this.log(`UNHANDLED ERROR: ${err}`);
      })
  } else {
    // FIXME: Setup mode
    this.log(`WARN: No RFY remotes configured`);
    this.removeAccessories();
  }
}

RFXComPlatform.prototype.listRFYRemotes = function() {
  return new Promise((resolve, reject) => {
    this.rfxtrx.once('rfyremoteslist', remotes => resolve(remotes));

    this.rfxtrx.initialise(() => {
      if(this.debug) this.log('RFXtrx initialized, listing remotes...');
      this.rfy.listRemotes();
    })
  })
}

// Method to add or update HomeKit accessories
RFXComPlatform.prototype.addRFYRemote = function(remote, device) {
  if(!remote || !device) return;

  remote.switches = {};
  remote.shutter  = null ;

  this.addSwitch(remote, device, DIRECTION.up);
  this.addSwitch(remote, device, DIRECTION.down);
  this.addShutter(remote, device);
}

// Switches
RFXComPlatform.prototype.addSwitch = function(remote, device, type) {
  if(!remote || !device || !type) return;

  const deviceID = remote.deviceID;
  const switchID = `${deviceID}/${type}`;

  if(this.debug) this.log(`Adding switch ${switchID}`);

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
      // Issue a stop if any switch is toggled off or the Stop switch is hit
      if(!value) {
        setTimeout(() => {
          for(const t in remote.switches) this.stopRemote(remote, remote.switches[t]);
        }, 100);

        return callback();
      }

      if(remote.openCloseSeconds) remote.shutter.context.totalDuration = Math.round(remote.openCloseSeconds * 1000);
      switch(type) {
        case DIRECTION.up:
          this.setShutterPositionState(remote, Characteristic.PositionState.INCREASING, _switch);
          break;
        case DIRECTION.down:
          this.setShutterPositionState(remote, Characteristic.PositionState.DECREASING, _switch);
          break;
      }
      if(this.debug) this.log(`RFY ${type} ${remote.deviceID}`);

      // Toggle all switches to the correct on/off state
      for(const t in remote.switches) this.setSwitch(remote.switches[t], t === type);

      // After a configurable amount of time, toggle the switch back to off
      this.resetSwitch(remote, _switch);

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

  if(this.debug) this.log(`Updating switch ${_switch.context.switchID}, on=${isOn}`);

  _switch.context.isOn = isOn
  _switch
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .getValue();
}

RFXComPlatform.prototype.setSwitchInterval = function(remote, type) {
  if(!remote || !type) return;

  remote.shutter.context.duration++;

  this.setShutterProcessPosition(remote.shutter);

  if(remote.shutter.context.duration > (remote.shutter.context.totalDuration / 1000)) this.stopRemote(remote, remote.switches[type], true);
}

RFXComPlatform.prototype.resetSwitch = function(remote, _switch) {
  if(!remote || !_switch) return;

  clearTimeout(_switch.context.timeout)
  _switch.context.timeout = setTimeout(() => {
    this.stopRemote(remote, _switch, true);
  }, remote.shutter.context.totalDuration);
}

// Shutters
RFXComPlatform.prototype.addShutter = function(remote, device) {
  if(!remote || !device) return;

  const deviceID  = remote.deviceID;
  const shutterID = `${deviceID}/Shutter`;

  if(this.debug) this.log(`Adding shutter ${shutterID}`);

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
    switchInterval  : null,
    shutterInterval : null,
    duration        : 0,
    totalDuration   : OPEN_CLOSE_SECONDS * 1000,
    direction       : DIRECTION.stop
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
    .on('get', callback => callback(null, _shutter.context.targetPosition));
    // @todo : WIP to make shutter placeholder interactive
    /* .on('set', (value, callback) => {
      if(_shutter.context.targetPosition === value) return callback();
      if(this.debug) this.log(`Updating shutter ${_shutter.context.shutterID}, currrentPosition=${_shutter.context.currentPosition}, targetPosition=${value}`);

      // Set target position
      this.setShutterTargetPosition(_shutter, value);
      if(_shutter.context.targetPosition === _shutter.context.currentPosition) return callback();

      // Move the shutter
      this.setShutterPositionState(remote, _shutter.context.targetPosition > _shutter.context.currentPosition ? Characteristic.PositionState.INCREASING : Characteristic.PositionState.DECREASING);

      // Hit the correct button
      let _switch = remote.switches[_shutter.context.direction];
      this.setSwitch(_switch, true);

      // Stop when the percentage is hit
      _shutter.context.shutterInterval = setInterval(() => this.setShutterInterval(remote), 1000);

      // After a configurable amount of time, toggle the switch back to off
      this.resetSwitch(remote, _switch);

      callback();
    }); */

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [_shutter]);

  // Set the initial shutter positions
  this.setShutterCurrentPosition(_shutter, _shutter.context.currentPosition);
  this.setShutterTargetPosition(_shutter, _shutter.context.targetPosition);
  this.setShutterProcessPosition(_shutter, _shutter.context.processPosition);
  this.setShutterPositionState(remote);

  return _shutter;
}

RFXComPlatform.prototype.setShutterPositionState = function(remote, positionState = Characteristic.PositionState.STOPPED, _switch = null) {
  if(!remote || !remote.shutter) return;

  if(this.debug) this.log(`Updating shutter ${remote.shutter.context.shutterID}, positionState=${positionState}`);

  remote.shutter.context.positionState = positionState;
  remote.shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.PositionState)
    .getValue();

  switch(remote.shutter.context.positionState) {
    case Characteristic.PositionState.INCREASING:
      if(remote.shutter.context.direction === DIRECTION.up || remote.shutter.context.currentPosition === 100) break;
      remote.shutter.context.direction = DIRECTION.up;
      this.rfy.up(remote.deviceID);
      if(_switch && remote) remote.shutter.context.switchInterval = setInterval(() => this.setSwitchInterval(remote, _switch), 1000);
      break;
    case Characteristic.PositionState.DECREASING:
      if(remote.shutter.context.direction === DIRECTION.down || remote.shutter.context.currentPosition === 0) break;
      remote.shutter.context.direction = DIRECTION.down;
      this.rfy.down(remote.deviceID);
      if(_switch && remote) remote.shutter.context.switchInterval = setInterval(() => this.setSwitchInterval(remote, _switch), 1000);
      break;
    case Characteristic.PositionState.STOPPED:
      if(remote.shutter.context.direction === DIRECTION.stop) break;
      remote.shutter.context.direction = DIRECTION.stop;
      if(remote.shutter.context.processPosition < 100 && remote.shutter.context.processPosition > 0) this.rfy.stop(remote.deviceID);
      break;
  }
}

RFXComPlatform.prototype.setShutterProcessPosition = function(_shutter, value = null) {
  if(!_shutter) return;

  let percent = 0;
  if(_shutter.context.duration > 0) percent = Math.round(((_shutter.context.duration * 100) / _shutter.context.totalDuration) * 1000);

  if(value !== null) _shutter.context.processPosition = value;
  else if(percent > 0 && _shutter.context.direction === DIRECTION.up) _shutter.context.processPosition = _shutter.context.currentPosition + percent;
  else if(percent > 0 && _shutter.context.direction === DIRECTION.down) _shutter.context.processPosition = _shutter.context.currentPosition - percent;

  if(value === null && (_shutter.context.processPosition > 100 || _shutter.context.processPosition < 0)) {
    if(_shutter.context.processPosition > 100) _shutter.context.processPosition = 100;
    else if(_shutter.context.processPosition < 0) _shutter.context.processPosition = 0;
    this.stopRemote(remote, remote.switches[type], true);
  }

  if(this.debug) this.log(`Updating shutter ${_shutter.context.shutterID}, direction=${_shutter.context.direction}, currentPosition=${_shutter.context.currentPosition}, processPosition=${_shutter.context.processPosition}, movedBy=${percent}%`);
}

RFXComPlatform.prototype.setShutterCurrentPosition = function(_shutter, value) {
  if(!_shutter) return;

  if(this.debug) this.log(`Updating shutter ${_shutter.context.shutterID}, currentPosition=${value}`);

  _shutter.context.currentPosition = value;
  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.CurrentPosition)
    .getValue();
}

RFXComPlatform.prototype.setShutterTargetPosition = function(_shutter, value) {
  if(!_shutter) return;

  if(this.debug) this.log(`Updating shutter ${_shutter.context.shutterID}, targetPosition=${value}`);

  _shutter.context.targetPosition = value
  _shutter
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.TargetPosition)
    .getValue();
}

RFXComPlatform.prototype.setShutterInterval = function(remote) {
  if(!remote || !remote.shutter) return;

  if((remote.shutter.context.direction === DIRECTION.up 
    && (remote.shutter.context.processPosition >= remote.shutter.context.targetPosition 
      || remote.shutter.context.processPosition >= 100))
  || (remote.shutter.context.direction === DIRECTION.down 
    && (remote.shutter.context.processPosition <= remote.shutter.context.targetPosition 
      || remote.shutter.context.processPosition <= 0)))
    this.stopRemote(remote, remote.switches[remote.shutter.context.direction]);
}

RFXComPlatform.prototype.stopRemote = function(remote, _switch = null, force = false) {
  if(!remote || !remote.shutter) return;

  clearInterval(remote.shutter.context.switchInterval);
  clearInterval(remote.shutter.context.shutterInterval);

  if(_switch) this.setSwitch(_switch, false);

  this.setShutterProcessPosition(remote.shutter, force ? (remote.shutter.context.direction === DIRECTION.up ? 100 : 0) : null);
  this.setShutterPositionState(remote);
  this.setShutterTargetPosition(remote.shutter, remote.shutter.context.processPosition);
  this.setShutterCurrentPosition(remote.shutter, remote.shutter.context.processPosition);

  remote.shutter.context.duration = 0;

  if(this.debug) this.log(`Stopping shutter ${remote.shutter.context.shutterID}, currentPosition=${remote.shutter.context.currentPosition}`);
}

// Method to remove an accessory from HomeKit
RFXComPlatform.prototype.removeAccessory = function(accessory) {
  if(!accessory) return;

  const id = accessory.context.switchID || accessory.context.shutterID;
  if(this.debug) this.log(`${accessory.context.name} (${id}) removed from HomeBridge.`);
  this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
  delete this.accessories[id];
}

// Method to remove all accessories from HomeKit
RFXComPlatform.prototype.removeAccessories = function() {
  this.accessories.forEach(id => this.removeAccessory(this.accessories[id]));
}
