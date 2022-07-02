const rfxcom = require('rfxcom');

const PLUGIN_ID = 'homebridge-rfxcom';
const PLUGIN_NAME = 'RFXCom';
const DEFAULT_OPEN_CLOSE_SECONDS = 25;

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
  this.config = config || { platform: 'RFXCom' };
  this.tty    = this.config.tty || '/dev/ttyUSB0';
  this.debug  = this.config.debug || false;

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
  var id = accessory.context.switchID || accessory.context.shutterID;

  this.log(`Loaded from cache: ${accessory.context.name} (${id})`);

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
        this.log(`Received ${deviceRemotes.length} remote(s) from device`);

        this.rfyRemotes.forEach(remote => {
          // Handle different capitalizations of deviceID
          remote.deviceID = remote.deviceID || remote.deviceId;
          const deviceID  = remote.deviceID;
          const device    = deviceRemotes.find(dR => deviceID === dR.deviceId);

          if(device) {
            // Remote found on the RFXCom device
            this.addRFYRemote(remote, device);
            this.log(`Added accessories for RFY remote ${remote.deviceID}`);
          } else {
            // No remote found on device
            const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
            this.log(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
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
      this.log('RFXtrx initialized, listing remotes...');
      this.rfy.listRemotes();
    })
  })
}

// Method to add or update HomeKit accessories
RFXComPlatform.prototype.addRFYRemote = function(remote, device) {
  remote.switches = {};
  remote.shutter  = null ;

  this.addSwitch(remote, device, 'Up');
  this.addSwitch(remote, device, 'Down');
  this.addShutter(remote, device);
}

// Switches
RFXComPlatform.prototype.addSwitch = function(remote, device, type) {
  const deviceID = remote.deviceID;
  const switchID = `${deviceID}/${type}`;

  this.log(`Adding switch ${switchID}`);

  // Setup accessory
  let accessory = this.accessories[switchID];
  if(accessory) this.removeAccessory(accessory);

  const name = `${remote.name} ${type}`;
  const uuid = UUIDGen.generate(switchID);
  accessory  = new Accessory(remote.name, uuid);

  this.accessories[switchID] = accessory;

  accessory.context = {
    deviceID: deviceID,
    switchID: switchID,
    name    : name,
    device  : device,
    isOn    : false
  }

  remote.switches[type] = accessory;

  // Setup HomeKit service
  accessory.addService(Service.Switch, name);

  // New accessory is always reachable
  accessory.reachable = true;
  accessory.updateReachability(true);

  // Setup HomeKit accessory information
  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'RFXCOM')
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${deviceID}-${device.unitCode}-${type}`);

  // Setup event listeners
  accessory
    .on('identify', (paired, callback) => {
      this.log(`${name} identify requested, paired=${paired}`);
      callback();
    })
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('get', callback => callback(null, accessory.context.isOn))
    .on('set', (value, callback) => {
      // Issue a stop if any switch is toggled off or the Stop switch is hit
      if(!value) {
        this.rfy.stop(remote.deviceID);

        setTimeout(() => {
          for(const t in remote.switches) this.stopRemote(remote, remote.switches[t]);
        }, 100);

        return callback();
      }

      remote.shutter.context.duration = 0;
      remote.shutter.context.totalDuration = isNaN(remote.openCloseSeconds) ? DEFAULT_OPEN_CLOSE_SECONDS * 1000 : Math.round(remote.openCloseSeconds * 1000);
      switch(type) {
        case 'Up':
          console.log(`RFY UP ${remote.deviceID}`);
          this.rfy.up(remote.deviceID);
          this.setShutterPositionState(remote.shutter, Characteristic.PositionState.INCREASING);
          remote.shutter.context.direction = type;
          remote.shutter.context.interval  = setInterval(() => this.setShutterInterval(remote, accessory), 1000);
          break;
        case 'Down':
          console.log(`RFY DOWN ${remote.deviceID}`);
          this.rfy.down(remote.deviceID);
          this.setShutterPositionState(remote.shutter, Characteristic.PositionState.DECREASING);
          remote.shutter.context.direction = type;
          remote.shutter.context.interval  = setInterval(() => this.setShutterInterval(remote, accessory), 1000);
          break;
      }

      // Toggle all switches to the correct on/off state
      for(const t in remote.switches) this.setSwitch(remote.switches[t], t === type);

      // After a configurable amount of time, toggle the switch back to off
      clearTimeout(accessory.timerID)
      accessory.timerID = setTimeout(() => {
        this.stopRemote(remote, accessory, true);
      }, remote.shutter.context.totalDuration);

      callback();
    });

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);

  // Set the initial switch position
  this.setSwitch(accessory, accessory.context.isOn);

  return accessory;
}

RFXComPlatform.prototype.setSwitch = function(accessory, isOn) {
  this.log(`Updating switch ${accessory.context.switchID}, on=${isOn}`);

  accessory.context.isOn = isOn
  accessory
    .getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .getValue();
}

// Shutters
RFXComPlatform.prototype.addShutter = function(remote, device) {
  const deviceID  = remote.deviceID;
  const shutterID = `${deviceID}/Shutter`;

  this.log(`Adding shutter ${shutterID}`);

  // Setup accessory
  let accessory = this.accessories[shutterID];
  if(accessory) this.removeAccessory(accessory);

  const name = `${remote.name} Shutter`;
  const uuid = UUIDGen.generate(shutterID);
  accessory  = new Accessory(remote.name, uuid);

  this.accessories[shutterID] = accessory;

  accessory.context = {
    deviceID       : deviceID,
    shutterID      : shutterID,
    name           : name,
    device         : device,
    positionState  : Characteristic.PositionState.STOPPED,
    currentPosition: 0,
    targetPosition : 0,
    interval       : null,
    duration       : 0,
    totalDuration  : 0,
    direction      : 'STOP'
  };

  remote.shutter = accessory;

  // Setup HomeKit service
  accessory.addService(Service.WindowCovering, name);

  // New accessory is always reachable
  accessory.reachable = true;
  accessory.updateReachability(true);

  // Setup HomeKit accessory information
  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'RFXCOM')
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${deviceID}-${device.unitCode}-Shutter`);

  // Setup event listeners
  accessory
    .on('identify', (paired, callback) => {
      this.log(`${name} identify requested, paired=${paired}`);
      callback();
    })
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.PositionState)
    .on('get', callback => callback(null, accessory.context.positionState));

  accessory
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.CurrentPosition)
    .on('get', callback => callback(null, accessory.context.currentPosition));

  accessory
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.TargetPosition)
    .on('get', callback => callback(null, accessory.context.targetPosition));

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);

  // Set the initial switch position
  this.setShutterPositionState(accessory, accessory.context.positionState);
  this.setShutterTargetPosition(accessory);
  this.setShutterCurrentPosition(accessory);

  return accessory;
}

RFXComPlatform.prototype.setShutterPositionState = function(accessory, positionState) {
  this.log(`Updating shutter ${accessory.context.shutterID}, positionState=${positionState}`);

  accessory.context.positionState = positionState;
  accessory
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.PositionState)
    .getValue();
}

RFXComPlatform.prototype.setShutterTargetPosition = function(accessory, value = null) {
  var percent = Math.round((accessory.context.duration * 100) / accessory.context.totalDuration * 1000);

  if(value) accessory.context.targetPosition = value;
  else if(percent > 0 && accessory.context.direction === 'Up') accessory.context.targetPosition = accessory.context.currentPosition + percent;
  else if(percent > 0 && accessory.context.direction === 'Down') accessory.context.targetPosition = accessory.context.currentPosition - percent;
  else percent = 0;

  if(accessory.context.targetPosition > 100) accessory.context.targetPosition = 100;
  if(accessory.context.targetPosition < 0) accessory.context.targetPosition = 0;

  this.log(`Updating shutter ${accessory.context.shutterID}, direction=${accessory.context.direction}, targetPosition=${accessory.context.targetPosition}, movedBy=${percent}%`);
  accessory
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.TargetPosition)
    .getValue();
}

RFXComPlatform.prototype.setShutterCurrentPosition = function(accessory) {
  this.log(`Updating shutter ${accessory.context.shutterID}, currentPosition=${accessory.context.targetPosition}`);
  accessory.context.currentPosition = accessory.context.targetPosition;
  accessory
    .getService(Service.WindowCovering)
    .getCharacteristic(Characteristic.CurrentPosition)
    .getValue();
}

RFXComPlatform.prototype.stopRemote = function(remote, accessorySwitch = null, force = false) {
  clearInterval(remote.shutter.context.interval);

  if(accessorySwitch) this.setSwitch(accessorySwitch, false);
  if(remote.shutter.context.direction === 'Up' && force) remote.shutter.context.currentPosition = remote.shutter.context.targetPosition = 100;
  if(remote.shutter.context.direction === 'Down' && force) remote.shutter.context.currentPosition = remote.shutter.context.targetPosition = 0;

  this.setShutterPositionState(remote.shutter, Characteristic.PositionState.STOPPED);
  this.setShutterTargetPosition(remote.shutter, force ? remote.shutter.context.targetPosition : null);
  this.setShutterCurrentPosition(remote.shutter);

  remote.shutter.context.direction = 'STOP';

  this.log(`Stopping shutter ${remote.shutter.context.shutterID}, currentPosition=${remote.shutter.context.currentPosition}`);
}

RFXComPlatform.prototype.setShutterInterval = function(remote, accessory) {
  remote.shutter.context.duration++;
  this.setShutterTargetPosition(remote.shutter);
  if(remote.shutter.context.duration > (remote.shutter.context.totalDuration / 1000) || remote.shutter.context.targetPosition >= 100 || remote.shutter.context.targetPosition <= 0) this.stopRemote(remote, accessory, true);
}

// Method to remove an accessory from HomeKit
RFXComPlatform.prototype.removeAccessory = function(accessory) {
  if(!accessory) return;

  const switchID = accessory.context.switchID;
  this.log(`${accessory.context.name} (${switchID}) removed from HomeBridge.`);
  this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
  delete this.accessories[switchID];
}

// Method to remove all accessories from HomeKit
RFXComPlatform.prototype.removeAccessories = function() {
  this.accessories.forEach(id => this.removeAccessory(this.accessories[id]));
}
