// Homebridge
import { Logger, PlatformAccessory } from 'homebridge';
// Settings
import { TYPE } from './settings';
// Platform
import { RFXComPlatform } from './platform';
// Accessories
import { SwitchAccessoryPlugin } from './switch';

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
    const _shutter: PlatformAccessory = this.platform.shutter.accessory;
    if ((_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING && _shutter.context.currentPosition === 100) ||
      (_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING && _shutter.context.currentPosition === 0)) return;

    // Stop if process is running
    if (_shutter.context.process) this.stop();

    // Switch Up
    const switchUp: SwitchAccessoryPlugin = this.platform.switches[TYPE.Up];
    switchUp.setOn(_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING);
    switchUp.reset();

    // Switch Down
    const switchDown: SwitchAccessoryPlugin = this.platform.switches[TYPE.Down];
    switchDown.setOn(_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING);
    switchDown.reset();

    // RFY Commands Up/Down
    switch (_shutter.context.positionState) {
      case this.platform.Characteristic.PositionState.INCREASING:
        this.rfy.up(_shutter.context.deviceID);
        break;
      case this.platform.Characteristic.PositionState.DECREASING:
        this.rfy.down(_shutter.context.deviceID);
        break;
    }

    // Launch processing
    _shutter.context.process = setInterval(() => this.processing(), 1000);

    this.log.info(`Remote ${_shutter.context.deviceID}: Starting ${_shutter.context.name}...`);
    if (this.debug) this.log.debug(`positionState=${_shutter.context.positionState}, currentPosition=${_shutter.context.currentPosition}.`);
  }

  /**
   * Stop process
   */
  stop() {
    const _shutter: PlatformAccessory = this.platform.shutter.accessory;

    // Stop process
    clearInterval(_shutter.context.process);

    // Reset switches
    for (const s in this.platform.switches) this.platform.switches[s].setOn(false);

    // Set shutter
    this.platform.shutter.setPositionState(this.platform.Characteristic.PositionState.STOPPED);
    this.platform.shutter.setTargetPosition(_shutter.context.currentPosition);

    // RFY Command Stop
    if (_shutter.context.currentPosition < 100 && _shutter.context.currentPosition > 0) this.rfy.stop(_shutter.context.deviceID);

    this.log.info(`Remote ${_shutter.context.deviceID}: Stopping ${_shutter.context.name}.`);
    if (this.debug) this.log.debug(`Remote ${_shutter.context.deviceID}: currentPosition=${_shutter.context.currentPosition}.`);
  }

  /**
   * Processing
   */
  processing() {
    const _shutter: PlatformAccessory = this.platform.shutter.accessory;

    // Calcul & set shutter current position
    let value = _shutter.context.currentPosition;
    if (_shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING) value += (100 / _shutter.context.duration);
    else if (_shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING) value -= (100 / _shutter.context.duration);
    this.platform.shutter.setCurrentPosition(value);

    if (this.debug) this.log.debug(`Remote ${_shutter.context.deviceID}: Processing ${_shutter.context.name}, 
      currentPosition=${_shutter.context.currentPosition}.`);
    else this.log.info(`Remote ${_shutter.context.deviceID}: Stopping RFY ${_shutter.context.positionState}.`);

    // Stop
    if (_shutter.context.currentPosition === 100 || _shutter.context.currentPosition === 0 ||
      ((_shutter.context.currentPosition <= _shutter.context.targetPosition &&
        _shutter.context.positionState === this.platform.Characteristic.PositionState.DECREASING) ||
        (_shutter.context.currentPosition >= _shutter.context.targetPosition &&
          _shutter.context.positionState === this.platform.Characteristic.PositionState.INCREASING))
    ) this.stop();
  }
}