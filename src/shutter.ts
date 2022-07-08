// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
// Settings
import { PLUGIN_NAME, OPEN_CLOSE_SECONDS, TYPE, DEFAULT_OVERTURE } from './settings';
// Platform
import { RFXComPlatform } from './platform';

/**
 * Shutter accessory
 */
export class ShutterAccessory {
  /**
   * Service
   */
  public readonly service: Service;

  /**
   * Characteristics
   */
  private readonly Characteristic = this.platform.Characteristic;
  public readonly state: any;
  public readonly current: any;
  public readonly target: any;

  /**
   * Context
   */
  public readonly context: any = {
    id: `${this.remote.deviceID}/${TYPE.Shutter}`,
    name: `${this.remote.name} ${TYPE.Shutter}`,
    deviceID: this.remote.deviceID,
    duration: this.remote.openCloseSeconds ?? OPEN_CLOSE_SECONDS,
    timeout: null,
    process: null,
  };

  /**
   * Constructor
   * @param {RFXComPlatform} platform
   * @param {PlatformAccessory} accessory
   * @param {any} remote
   */
  constructor(
    private readonly platform: RFXComPlatform,
    public accessory: PlatformAccessory,
    private remote: any,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.Characteristic.Model, 'RFY')
      .setCharacteristic(this.Characteristic.SerialNumber, `${this.remote.deviceID}/Shutter`);

    // Set service
    this.service = this.accessory.getService(this.platform.Service.WindowCovering)
      || this.accessory.addService(this.platform.Service.WindowCovering);

    // Set context
    this.accessory.context.id = this.context.id;
    this.accessory.context.name = this.context.name;

    // Get characteristics
    this.state = this.service.getCharacteristic(this.Characteristic.PositionState);
    this.current = this.service.getCharacteristic(this.Characteristic.CurrentPosition);
    this.target = this.service.getCharacteristic(this.Characteristic.TargetPosition);

    // Set event listeners
    this.state.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.state.updateValue(value);
      if(this.platform.debug) this.platform.log.debug(`Remote ${this.context.deviceID}: state=${this.state.value}.`);

      switch(this.state.value) {
        case this.Characteristic.PositionState.STOPPED:
          this.stop();
          if (this.current.value < 100 && this.current.value > 0) this.platform.rfy.stop(this.remote.deviceID);
          this.current.setValue(Math.round(this.current.value));
          this.target.setValue(this.current.value);
          break;
        case this.Characteristic.PositionState.INCREASING:
          this.start();
          this.platform.rfy.up(this.remote.deviceID);
          break;
        case this.Characteristic.PositionState.DECREASING:
          this.start();
          this.platform.rfy.down(this.remote.deviceID);
          break;
      }

      callback();
    });
    this.target.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      if(value === this.current.value) return callback();
      // Set shutter
      this.target.updateValue(value);
      if(this.platform.debug) this.platform.log.debug(`Remote ${this.context.deviceID}: target=${this.target.value}.`);

      this.state.setValue(this.target.value > this.current.value ?
        this.Characteristic.PositionState.INCREASING : this.Characteristic.PositionState.DECREASING);

      callback();
    });

    // Init shutter
    this.state.updateValue(this.Characteristic.PositionState.STOPPED);
    this.current.updateValue(DEFAULT_OVERTURE);
    this.target.updateValue(this.current.value);
  }

  /**
   * Start shutter movement
   */
  start() {
    if ((this.state.value === this.Characteristic.PositionState.INCREASING && this.current.value === 100) ||
      (this.state.value === this.Characteristic.PositionState.DECREASING && this.current.value === 0)) {
      this.state.setValue(this.Characteristic.PositionState.STOPPED);
      return;
    }

    // Stop process if already running
    if (this.context.process) clearInterval(this.context.process);

    // Set switches to correct state
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.remote.deviceID];
      switches[TYPE.Up].state.updateValue(this.state.value === this.Characteristic.PositionState.INCREASING);
      switches[TYPE.Down].state.updateValue(this.state.value === this.Characteristic.PositionState.DECREASING);
    }

    // Launch processing
    this.context.process = setInterval(() => this.processing(), 250);

    this.platform.log.info(`Remote ${this.context.deviceID}: Starting...`);
    if (this.platform.debug) {
      this.platform.log.debug(`Remote ${this.context.deviceID}: state=${this.state.value}.`);
      this.platform.log.debug(`Remote ${this.context.deviceID}: current=${this.current.value}.`);
      this.platform.log.debug(`Remote ${this.context.deviceID}: target=${this.target.value}.`);
    }
  }

  /**
   * Stop shutter movement
   */
  stop() {
    // Stop process
    clearInterval(this.context.process);

    // Reset switches if exists
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.remote.deviceID];
      for (const s in switches) switches[s].state.updateValue(false);
    }

    this.platform.log.info(`Remote ${this.context.deviceID}: Stopping.`);
    if (this.platform.debug) {
      this.platform.log.debug(`Remote ${this.context.deviceID}: state=${this.state.value}.`);
      this.platform.log.debug(`Remote ${this.context.deviceID}: current=${this.current.value}.`);
      this.platform.log.debug(`Remote ${this.context.deviceID}: target=${this.target.value}.`);
    }
  }

  /**
   * Processing shutter movement
   */
  processing() {
    // Calcul current position
    let value:any = this.current.value;
    if(!value) return;
    if (this.state.value === this.Characteristic.PositionState.INCREASING) value += (100 / this.context.duration) / 4;
    else if (this.state.value === this.Characteristic.PositionState.DECREASING) value -= (100 / this.context.duration) / 4;
    if(value > 100) value = 100;
    else if(value < 0) value = 0;

    // Set current position
    this.current.setValue(value);
    if(this.platform.debug) this.platform.log.debug(`Remote ${this.context.deviceID}: current=${this.current.value}.`);

    // Stop
    if (this.current.value === 100 || this.current.value === 0
      || ((this.current.value <= this.target.value && this.state.value === this.Characteristic.PositionState.DECREASING)
      || (this.current.value >= this.target.value && this.state.value === this.Characteristic.PositionState.INCREASING))
    ) this.state.setValue(this.Characteristic.PositionState.STOPPED);
  }
}