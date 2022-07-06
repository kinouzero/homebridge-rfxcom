import { DIRECTION, MODE } from './settings';

import { Remote } from './Remote';
import { ShutterAccessory } from './ShutterAccessory';
import { Logger } from 'homebridge';

export class Process {
  public readonly config: any;
  public readonly log: Logger;
  public readonly api: object;
  public readonly debug: boolean;
  public readonly rfy: any;

  constructor(
    private readonly remote: Remote,
  ) {
    this.log = remote.platform.log;
    this.config = remote.platform.config;
    this.api = remote.platform.api;
    this.debug = this.config.debug || false;

    this.rfy = remote.platform.rfy;
    this.remote = remote;
  }

  /**
   * Start process
   */
  start() {
    let _shutter: ShutterAccessory;
    if (!this.remote || !(_shutter = this.remote.shutter) ||
      (this.remote.context.direction === DIRECTION.up && _shutter.context.currentPosition === 100) ||
      (this.remote.context.direction === DIRECTION.down && _shutter.context.currentPosition === 0)) {
      return;
    }

    // Stop if process is running
    if (this.remote.context.process) {
      this.stop();
    }

    // Switches
    for (const d in this.remote.switches) {
      this.remote.switches[d].setOn(d === this.remote.context.direction);
      this.remote.switches[d].reset(this.remote);
    }

    // RFY Commands Up/Down
    if (this.remote.context.direction === DIRECTION.up) {
      _shutter.setPositionState(this.remote.platform.Characteristic.PositionState.INCREASING);
      this.rfy.up(this.remote.rfyRemote.deviceID);
    } else if (this.remote.context.direction === DIRECTION.down) {
      _shutter.setPositionState(this.remote.platform.Characteristic.PositionState.DECREASING);
      this.rfy.down(this.remote.rfyRemote.deviceID);
    }

    // Start new process
    if ([DIRECTION.up, DIRECTION.down].includes(this.remote.context.direction)) {
      this.remote.context.process = setInterval(() => this.processing(), 1000);
    }

    if (this.debug) {
      this.log.debug(`Remote ${this.remote.rfyRemote.deviceID}: Starting ${_shutter.context.name}, 
                      direction=${this.remote.context.direction}, currentPosition=${_shutter.context.currentPosition}`);
    } else {
      this.log.info(`Remote ${this.remote.rfyRemote.deviceID}: Processing RFY ${this.remote.context.direction}...`);
    }
  }

  /**
   * Stop process
   */
  stop() {
    let _shutter: ShutterAccessory;
    if (!this.remote || !(_shutter = this.remote.shutter)) {
      return;
    }

    // Stop process
    clearInterval(this.remote.context.process);

    // Set direction to stop
    if (this.remote.context.direction === DIRECTION.stop) {
      return;
    }
    this.remote.context.direction = DIRECTION.stop;

    // Reset switches
    for (const d in this.remote.switches) {
      this.remote.switches[d].setOn(false);
    }

    // Set shutter
    _shutter.setPositionState(this.remote.platform.Characteristic.PositionState.STOPPED);
    _shutter.setTargetPosition(_shutter.context.currentPosition);

    // RFY Command Stop
    if (_shutter.context.currentPosition < 100 && _shutter.context.currentPosition > 0) {
      this.rfy.stop(this.remote.rfyRemote.deviceID);
    }

    if (this.debug) {
      this.log.debug(`Remote ${this.remote.rfyRemote.deviceID}: Stopping ${_shutter.context.name}, 
                      currentPosition=${_shutter.context.currentPosition}`);
    }
  }

  /**
   * Processing
   */
  processing() {
    let _shutter: ShutterAccessory;
    if (!this.remote || !(_shutter = this.remote.shutter)) {
      return;
    }

    // Set shutter current position
    let value = _shutter.context.currentPosition;
    if (this.remote.context.direction === DIRECTION.up) {
      value += (100 / this.remote.context.duration);
    } else if (this.remote.context.direction === DIRECTION.down) {
      value -= (100 / this.remote.context.duration);
    }
    _shutter.setCurrentPosition(value);

    if (this.debug) {
      this.log.debug(`Remote ${this.remote.rfyRemote.deviceID}: Processing ${_shutter.context.name}, 
                      currentPosition=${_shutter.context.currentPosition}`);
    } else {
      this.log.info(`Remote ${this.remote.rfyRemote.deviceID}: Stopping RFY ${this.remote.context.direction}`);
    }

    // Stop
    if (_shutter.context.currentPosition === 100 || _shutter.context.currentPosition === 0 || (this.remote.context.mode === MODE.target && (
      (_shutter.context.currentPosition <= _shutter.context.targetPosition && this.remote.context.direction === DIRECTION.down) ||
      (_shutter.context.currentPosition >= _shutter.context.targetPosition && this.remote.context.direction === DIRECTION.up)))) {
      this.stop();
    }
  }
}