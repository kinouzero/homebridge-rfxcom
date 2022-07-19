// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Nullable, PlatformAccessory } from 'homebridge';
// Settings
import { PLUGIN_NAME, OPEN_CLOSE_SECONDS, TYPE, DEFAULT_OVERTURE } from './settings';
// Platform
import { RFXComPlatform } from './platform';

/**
 * Shutter accessory
 */
export class Shutter {
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
    current?: Nullable<CharacteristicValue>,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.Characteristic.Model, 'RFY')
      .setCharacteristic(this.Characteristic.SerialNumber, `${this.context.deviceID}/${this.context.duration}/Shutter`);

    // Set service
    const service = this.accessory.getService(this.platform.Service.WindowCovering)
      || this.accessory.addService(this.platform.Service.WindowCovering);

    // Set context
    this.accessory.context.id = this.context.id;
    this.accessory.context.name = this.context.name;

    // Get characteristics
    this.state = service.getCharacteristic(this.Characteristic.PositionState);
    this.current = service.getCharacteristic(this.Characteristic.CurrentPosition);
    this.target = service.getCharacteristic(this.Characteristic.TargetPosition);

    // Set event listeners
    this.current.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      // For caching purpose
      this.accessory.context.current = value;
      callback();
    });
    this.target.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      // Start process
      this.start(value);
      callback();
    });

    // Init shutter
    this.state.updateValue(this.Characteristic.PositionState.STOPPED);
    this.current.setValue(current ?? DEFAULT_OVERTURE);
    this.target.updateValue(this.current.value);
  }

  /**
   * Start shutter
   */
  async start(target: CharacteristicValue) {
    // Set shutter
    switch(true) {
      case (target === this.current.value):
        this.state.setValue(this.Characteristic.PositionState.STOPPED);
        break;
      case (target > this.current.value):
        this.state.setValue(this.Characteristic.PositionState.INCREASING);
        break;
      case (target < this.current.value):
        this.state.setValue(this.Characteristic.PositionState.DECREASING);
        break;
    }

    // Security
    if (this.state.value === this.Characteristic.PositionState.STOPPED ||
      (this.state.value === this.Characteristic.PositionState.INCREASING && this.current.value === 100) ||
      (this.state.value === this.Characteristic.PositionState.DECREASING && this.current.value === 0)
    ) {
      this.stop();
      return;
    }

    // Set switches
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.context.deviceID];
      switches[TYPE.Up].state.updateValue(this.state.value === this.Characteristic.PositionState.INCREASING);
      switches[TYPE.Down].state.updateValue(this.state.value === this.Characteristic.PositionState.DECREASING);
    }

    // RFY commands
    if(this.state.value === this.Characteristic.PositionState.INCREASING) this.platform.rfy.up(this.context.deviceID);
    if(this.state.value === this.Characteristic.PositionState.DECREASING) this.platform.rfy.down(this.context.deviceID);

    // Start process
    this.context.process = setInterval(() => this.processing(target), 500);

    // Log
    this.platform.log.info(`[Remote ${this.context.deviceID}] Starting...`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${target}.`);
  }

  /**
   * Stop shutter
   */
  async stop() {
    // Stop process
    if (this.context.process) clearInterval(this.context.process);

    // RFY stop command
    if (this.current.value < 100 && this.current.value > 0) this.platform.rfy.stop(this.context.deviceID);

    // Set shutter
    this.state.setValue(this.Characteristic.PositionState.STOPPED);

    // Reset switches
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.context.deviceID];
      switches[TYPE.Up].state.updateValue(false);
      switches[TYPE.Down].state.updateValue(false);
    }

    // Log
    this.platform.log.info(`[Remote ${this.context.deviceID}] Stopping.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${this.target.value}.`);
  }

  /**
   * Processing shutter
   */
  async processing(target: CharacteristicValue) {
    let value:any = this.current.value;
    if(!value) return;

    // Calcul current position
    switch(this.state.value) {
      case this.Characteristic.PositionState.INCREASING:
        value += (100 / this.context.duration) / 2;
        break;
      case this.Characteristic.PositionState.DECREASING:
        value -= (100 / this.context.duration) / 2;
        break;
    }
    if(value > 100) value = 100;
    else if(value < 0) value = 0;

    // Set current positon
    this.current.setValue(value);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);

    // Stop
    if (this.current.value === 100 || this.current.value === 0 ||
      (this.current.value <= target && this.state.value === this.Characteristic.PositionState.DECREASING) ||
      (this.current.value >= target && this.state.value === this.Characteristic.PositionState.INCREASING)
    ) {
      this.current.setValue(Math.round(this.current.value));
      this.stop();
    }
  }
}