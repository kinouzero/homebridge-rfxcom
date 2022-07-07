// Homebridge
import { Logger, PlatformAccessory } from 'homebridge';
// Settings
import { TYPE } from './settings';
// Platform
import { RFXComPlatform } from './platform';
// Accessories
import { SwitchAccessory } from './switch';
import { ShutterAccessory } from './shutter';

export class Process {
  /**
   * Log
   */
  private log: Logger;
  /**
   * Rfy API
   */
  private rfy: any;
  /**
   * Debug mode
   */
  private debug: boolean;

  /**
   * Constructor
   * @param {RFXComPlatform} platform
   */
  constructor(
    private platform: RFXComPlatform,
    private readonly remote: any,
  ) {
    // Init
    this.log = platform.log;
    this.rfy = platform.rfy;
    this.debug = platform.debug || false;
  }

  /**
   * Start process
   */
  start() {
    const _shutter: PlatformAccessory = this.platform.shutter[this.remote.deviceID].accessory;

    if ((_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING && _shutter.context.currentPosition === 100) ||
      (_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING && _shutter.context.currentPosition === 0)) return;

    // Stop process if already running
    if (_shutter.context.process) this.stop();

    if(this.platform.withSwitches) {
      // Switch Up
      const switchUp: SwitchAccessory = this.platform.switches[this.remote.deviceID][TYPE.Up];
      switchUp.setOn(_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING);

      // Switch Down
      const switchDown: SwitchAccessory = this.platform.switches[this.remote.deviceID][TYPE.Down];
      switchDown.setOn(_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING);
    }

    // RFY Commands Up/Down
    switch (_shutter.context.positionState) {
      case this.platform.Characteristic.PositionState.INCREASING:
        this.rfy.up(this.remote.deviceID);
        break;
      case this.platform.Characteristic.PositionState.DECREASING:
        this.rfy.down(this.remote.deviceID);
        break;
    }

    // Launch processing
    _shutter.context.process = setInterval(() => this.processing(), 250);

    this.log.info(`Remote ${_shutter.context.deviceID}: Starting ${_shutter.context.name}...`);
    if (this.debug) {
      this.log.debug(`Remote ${_shutter.context.deviceID}: currentPosition=${_shutter.context.currentPosition}.`);
      this.log.debug(`Remote ${_shutter.context.deviceID}: targetPosition=${_shutter.context.targetPosition}.`);
      this.log.debug(`Remote ${_shutter.context.deviceID}: positionState=${_shutter.context.positionState}.`);
    }
  }

  /**
   * Stop process
   */
  stop() {
    const shutter: ShutterAccessory = this.platform.shutter[this.remote.deviceID];
    const _shutter: PlatformAccessory = shutter.accessory;

    // Stop process
    clearInterval(_shutter.context.process);

    // Reset switches if exists
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.remote.deviceID];
      for (const s in switches) switches[s].setOn(false);
    }

    this.log.info(`Remote ${_shutter.context.deviceID}: Stopping ${_shutter.context.name}.`);
    if (this.debug) {
      this.log.debug(`Remote ${_shutter.context.deviceID}: currentPosition=${_shutter.context.currentPosition}.`);
      this.log.debug(`Remote ${_shutter.context.deviceID}: targetPosition=${_shutter.context.targetPosition}.`);
      this.log.debug(`Remote ${_shutter.context.deviceID}: positionState=${_shutter.context.positionState}.`);
    }
  }

  /**
   * Processing
   */
  processing() {
    const shutter: ShutterAccessory = this.platform.shutter[this.remote.deviceID];
    const _shutter: PlatformAccessory = shutter.accessory;

    // Calcul & set shutter current position
    let value = _shutter.context.currentPosition;
    if (_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING) value += (100 / _shutter.context.duration) / 4;
    else if (_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING) value -= (100 / _shutter.context.duration) / 4;
    shutter.setCurrentPosition(value);

    // Stop
    if (_shutter.context.currentPosition === 100 || _shutter.context.currentPosition === 0 ||
      ((_shutter.context.currentPosition <= _shutter.context.targetPosition &&
        _shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING) ||
        (_shutter.context.currentPosition >= _shutter.context.targetPosition &&
          _shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING))
    ) {
      // RFY command Stop if needed
      if (_shutter.context.currentPosition < 100 && _shutter.context.currentPosition > 0) this.rfy.stop(this.remote.deviceID);
      // Set shutter state
      shutter.setCurrentPosition(Math.round(_shutter.context.currentPosition));
      shutter.setPositionState(this.platform.Characteristic.PositionState.STOPPED);
      // Stop process
      this.stop();
    }
  }
}