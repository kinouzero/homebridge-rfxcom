const rfxcom = require('rfxcom');

const PLUGIN_ID          = 'homebridge-rfxcom';
const PLUGIN_NAME        = 'RFXCom';
const TTY                = '/dev/ttyUSB0';
const OPEN_CLOSE_SECONDS = 25;
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

/**
 * Constructor
 * @param {function} log
 * @param {object} config
 * @param {object} api
 */
function RFXComPlatform(log, config, api) {
  this.log    = log;
  this.config = config || { platform: PLUGIN_NAME };
  this.tty    = this.config.tty || TTY;
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

/**
 * Setup accesories from config.json
 */
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
            this.log(`Remote ${remote.deviceID}: Added shutter and switches Up/Down.`);
          } else {
            // No remote found on device
            const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
            this.log(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
          }
        })
      })
      .catch(error => {
        this.log(`UNHANDLED ERROR : ${error}`);
        if(this.debug) console.log(error.stack);
      })
  } else {
    this.log(`WARNING: No RFY remotes configured`);
    this.removeAccessories();
  }
}

/**
 * Load accessory from cache
 * @param {platformAccessory} accessory
 */
RFXComPlatform.prototype.configureAccessory = function(accessory) {
  if(!accessory) return;

  let id = accessory.context.switchID || accessory.context.shutterID;

  if(this.debug) this.log(`Loaded from cache: ${accessory.context.name} (${id})`);

  const existing = this.accessories[id];
  if(existing) this.removeAccessory(existing);

  this.accessories[id] = accessory;
}

/**
 * Remove an accessory
 * @param {platformAccessory} accessory
 */
RFXComPlatform.prototype.removeAccessory = function(accessory) {
  if(!accessory) return;

  this.log(`${accessory.context.name} removed from HomeBridge.`);

  this.api.unregisterPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [accessory]);
  delete this.accessories[accessory.context.switchID || accessory.context.shutterID];
}

/**
 * Remove all accesories
 */
RFXComPlatform.prototype.removeAccessories = function() {
  this.accessories.forEach(id => this.removeAccessory(this.accessories[id]));
}

/**
 * List remotes from RFXtrx
 */
RFXComPlatform.prototype.listRemotes = function() {
  return new Promise((resolve, reject) => {
    this.rfxtrx.once('rfyremoteslist', remotes => resolve(remotes));

    this.rfxtrx.initialise(() => {
      if(this.debug) this.log('RFXtrx initialized, listing remotes...');
      this.rfy.listRemotes();
    })
  })
}

/**
 * Add remote
 * @param {object} remote
 * @param {object} device
 */
RFXComPlatform.prototype.addRemote = function(remote, device) {
  if(!remote || !device) return;

  remote.shutter  = null;
  remote.switches = {};
  remote.context = {
    timeout   : null,
    process   : null,
    duration  : this.openCloseSeconds ? this.openCloseSeconds : OPEN_CLOSE_SECONDS,
    direction : DIRECTION.stop,
    mode      : MODE.switch,
  }

  this.addShutter(remote, device);
  this.addSwitch(remote, device, DIRECTION.up);
  this.addSwitch(remote, device, DIRECTION.down);
}

/**
 * Add shutter
 * @param {object} remote
 * @param {object} device
 * @return {platformAccessory} shutter
 */
 RFXComPlatform.prototype.addShutter = function(remote, device) {
  if(!remote || !device) return;

  if(this.debug) this.log(`Remote ${remote.deviceID}: Adding shutter...`);

  // Setup accessory
  const shutterID = `${remote.deviceID}/Shutter`;
  const name      = `${remote.name} Shutter`;
  const uuid      = UUIDGen.generate(shutterID);
  let _shutter    = this.accessories[shutterID];
  if(_shutter) this.removeAccessory(_shutter);
  _shutter = new Accessory(remote.name, uuid);

  this.accessories[shutterID] = _shutter;

  _shutter.context = {
    deviceID        : remote.deviceID,
    shutterID       : shutterID,
    name            : name,
    device          : device,
    positionState   : Characteristic.PositionState.STOPPED,
    currentPosition : 50,
    targetPosition  : 50,
  };

  remote.shutter = _shutter;

  // Setup HomeKit service
  _shutter.addService(Service.WindowCovering, name);

  // New shutter is always reachable
  _shutter.reachable = true;
  _shutter.updateReachability(true);

  // Setup HomeKit shutter information
  _shutter.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, PLUGIN_NAME)
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${remote.deviceID}-${device.unitCode}-Shutter`);

  // Setup event listeners
  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.PositionState)
    .on('get', callback => callback(null, _shutter.context.positionState));

  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.CurrentPosition)
    .on('get', callback => callback(null, _shutter.context.currentPosition));

  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.TargetPosition)
    .on('get', callback => callback(null, _shutter.context.targetPosition))
    .on('set', (value, callback) => {
      if(_shutter.context.currentPosition === value) return callback();

      // Set target position
      this.setShutterTargetPosition(_shutter, value);

      // Set mode & direction
      remote.context.mode      = MODE.target;
      remote.context.direction = _shutter.context.targetPosition > _shutter.context.currentPosition ? DIRECTION.up : DIRECTION.down;

      // Start action
      this.start(remote);

      callback();
    });

  // Register new accessory in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [_shutter]);

  // Set the initial shutter positions
  this.setShutterCurrentPosition(_shutter, _shutter.context.currentPosition);
  this.setShutterTargetPosition(_shutter, _shutter.context.targetPosition);
  this.setShutterPositionState(_shutter, Characteristic.PositionState.STOPPED);

  if(this.debug) this.log(`Remote ${remote.deviceID}: Added ${name}.`);

  return _shutter;
}

/**
 * Add switch
 * @param {object} remote
 * @param {object} device
 * @param {string} direction Up|Down
 * @return {platformAccessory} switch
 */
 RFXComPlatform.prototype.addSwitch = function(remote, device, direction) {
  if(!remote || !device || !direction) return;

  if(this.debug) this.log(`Remote ${remote.deviceID}: Adding switch...`);

  // Setup accessory
  const switchID = `${remote.deviceID}/${direction}`;
  const name     = `${remote.name} ${direction}`;
  const uuid     = UUIDGen.generate(switchID);
  let _switch    = this.accessories[switchID];

  if(_switch) this.removeAccessory(_switch);
  _switch = new Accessory(remote.name, uuid);

  this.accessories[switchID] = _switch;

  _switch.context = {
    deviceID : remote.deviceID,
    switchID : switchID,
    name     : name,
    device   : device,
    on       : false
  }

  remote.switches[direction] = _switch;

  // Setup HomeKit service
  _switch.addService(Service.Switch, name);

  // New switch is always reachable
  _switch.reachable = true;
  _switch.updateReachability(true);

  // Setup HomeKit switch information
  _switch.getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, PLUGIN_NAME)
    .setCharacteristic(Characteristic.Model, device.remoteType)
    .setCharacteristic(Characteristic.SerialNumber, `${remote.deviceID}-${device.unitCode}-${direction}`);

  // Setup event listeners
  _switch.getService(Service.Switch).getCharacteristic(Characteristic.On)
    .on('get', callback => callback(null, _switch.context.on))
    .on('set', (value, callback) => {
      // Stop if toggled off
      if(!value) {
        this.stop(remote);

        return callback();
      }

      // Set mode & direction
      remote.context.mode      = MODE.switch;
      remote.context.direction = direction;

      // Start action
      this.start(remote);

      callback();
    });

  // Register new switch in HomeKit
  this.api.registerPlatformAccessories(PLUGIN_ID, PLUGIN_NAME, [_switch]);

  // Set the initial switch position
  this.setSwitch(_switch, _switch.context.on);

  if(this.debug) this.log(`Remote ${remote.deviceID}: Added ${name}.`);

  return _switch;
}

/**
 * Set shutter current position
 * @param {platformAccessory} _shutter
 * @param {int} value between 0 and 100
 */
 RFXComPlatform.prototype.setShutterCurrentPosition = function(_shutter, value) {
  if(!_shutter || typeof value === undefined) return;

  // Check value boundaries
  if(value > 100) value = 100;
  else if(value < 0) value = 0;

  if(this.debug) this.log(`Remote ${_shutter.context.deviceID}: Set ${_shutter.context.name}, currentPosition=${value}.`);

  _shutter.context.currentPosition = value ?? _shutter.context.currentPosition;
  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.CurrentPosition).getValue();
}

/**
 * Set shutter target position
 * @param {platformAccessory} _shutter
 * @param {int} value between 0 and 100
 */
RFXComPlatform.prototype.setShutterTargetPosition = function(_shutter, value) {
  if(!_shutter) return;

  // Check value boundaries
  if(value > 100) value = 100;
  else if(value < 0) value = 0;

  if(this.debug) this.log(`Remote ${_shutter.context.deviceID}: Set ${_shutter.context.name}, targetPosition=${value}.`);

  _shutter.context.targetPosition = value ?? _shutter.context.targetPosition;
  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.TargetPosition).getValue();
}

/**
 * Set shutter position state
 * @param {platformAccessory} _shutter
 * @param {int} value 0: Decreasing | 1: Increasing | 2: Stopped
 */
RFXComPlatform.prototype.setShutterPositionState = function(_shutter, value) {
  if(!_shutter || !value) return;

  if(this.debug) this.log(`Remote ${_shutter.context.deviceID}: Set ${_shutter.context.name}, positionState=${value}.`);

  _shutter.context.positionState = value ?? _shutter.context.positionState;
  _shutter.getService(Service.WindowCovering).getCharacteristic(Characteristic.PositionState).getValue();
}

/**
 * Set switch state
 * @param {platformAccessory} _switch
 * @param {boolean} value
 */
RFXComPlatform.prototype.setSwitch = function(_switch, value) {
  if(!_switch) return;

  if(this.debug) this.log(`Remote ${_switch.context.deviceID}: Set ${_switch.context.name}, on=${value}.`);

  _switch.context.on = value ?? _switch.context.on;
  _switch.getService(Service.Switch).getCharacteristic(Characteristic.On).getValue();
}

/**
 * Reset switch
 * @param {object} remote
 * @param {string} direction Up|Down
 */
RFXComPlatform.prototype.resetSwitch = function(remote, direction) {
  if(!remote) return;

  clearTimeout(remote.timeout);

  remote.timeout = setTimeout(() => this.stop(remote), remote.duration * 1000);
}

/**
 * Start process
 * @param {object} remote
 */
RFXComPlatform.prototype.start = function(remote) {
  if(!remote || !(_shutter = remote.shutter) ||
    (remote.context.direction === DIRECTION.up && _shutter.context.currentPosition === 100) ||
    (remote.context.direction === DIRECTION.down && _shutter.context.currentPosition === 0))
      return;

  // Stop if process is running
  if(remote.context.process) this.stop(remote);

  // Switches
  for(const d in remote.switches) {
    this.setSwitch(remote.switches[d], d === remote.context.direction);
    this.resetSwitch(remote, d);
  }

  // RFY Commands Up/Down
  if(remote.context.direction === DIRECTION.up) {
    this.setShutterPositionState(_shutter, Characteristic.PositionState.INCREASING);
    this.rfy.up(remote.deviceID);
  } else if(remote.context.direction === DIRECTION.down) {
    this.setShutterPositionState(_shutter, Characteristic.PositionState.DECREASING);
    this.rfy.down(remote.deviceID);
  }

  // Start new process
  if([DIRECTION.up, DIRECTION.down].includes(remote.context.direction)) remote.context.process = setInterval(() => this.process(remote), 1000);

  if(this.debug) this.log(`Remote ${remote.deviceID}: Starting ${_shutter.context.name}, direction=${_shutter.context.direction}, currentPosition=${_shutter.context.currentPosition}`);
  else this.log(`Remote ${remote.deviceID}: Processing RFY ${_shutter.context.direction}...`);
}

/**
 * Stop process
 * @param {object} remote
 */
RFXComPlatform.prototype.stop = function(remote) {
  if(!remote || !(_shutter = remote.shutter)) return;

  // Stop process
  clearInterval(remote.context.process);

  // Set direction to stop
  if(remote.context.direction === DIRECTION.stop) return;
  remote.context.direction = DIRECTION.stop;

  // Reset switches
  for(const d in remote.switches) this.setSwitch(remote.switches[d], false);

  // Set shutter
  this.setShutterPositionState(_shutter, Characteristic.PositionState.STOPPED);
  this.setShutterTargetPosition(_shutter, _shutter.context.currentPosition);

  // RFY Command Stop
  if(_shutter.context.currentPosition < 100 && _shutter.context.currentPosition > 0) this.rfy.stop(remote.deviceID);

  if(this.debug) this.log(`Remote ${remote.deviceID}: Stopping ${_shutter.context.name}, currentPosition=${_shutter.context.currentPosition}`);
}

/**
 * Process
 * @param {object} remote
 */
 RFXComPlatform.prototype.process = function(remote) {
  if(!remote || !(_shutter = remote.shutter)) return;

  // Set shutter current position
  let value = _shutter.context.currentPosition;
  if(remote.context.direction === DIRECTION.up) value += (100 / remote.context.duration);
  if(remote.context.direction === DIRECTION.down) value -= (100 / remote.context.duration);
  this.setShutterCurrentPosition(_shutter, value);

  if(this.debug) this.log(`Remote ${remote.deviceID}: Processing ${_shutter.context.name}, currentPosition=${_shutter.context.currentPosition}`);
  else this.log(`Remote ${remote.deviceID}: Stopping RFY ${remote.context.direction}`);

  // Stop
  if(_shutter.context.currentPosition === 100 || _shutter.context.currentPosition === 0 || (remote.context.mode === MODE.target && (
    (_shutter.context.currentPosition <= _shutter.context.targetPosition && remote.context.direction === DIRECTION.down) ||
    (_shutter.context.currentPosition >= _shutter.context.targetPosition && remote.context.direction === DIRECTION.up))))
      this.stop(remote);
}