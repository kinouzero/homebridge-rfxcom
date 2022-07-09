// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Nullable, PlatformAccessory } from 'homebridge';
// Settings
import { PLUGIN_NAME, OPEN_CLOSE_SECONDS, TYPE, DEFAULT_OVERTURE } from './settings';
// Platform
import { RFXComPlatform } from './platform';

/**
 * Shutter accessory
 */
export class ShutterAccessory {
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
    this.state.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.state.updateValue(value);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);

      // Shutter actions
      switch(this.state.value) {
        // Stop shutter
        case this.Characteristic.PositionState.STOPPED:
          this.stop();
          if (this.current.value < 100 && this.current.value > 0) this.platform.rfy.stop(this.context.deviceID);
          this.current.setValue(Math.round(this.current.value));
          this.target.setValue(this.current.value);
          return callback();
        // Move shutter up
        case this.Characteristic.PositionState.INCREASING:
          this.platform.rfy.up(this.context.deviceID);
          break;
        // Move shutter down
        case this.Characteristic.PositionState.DECREASING:
          this.platform.rfy.down(this.context.deviceID);
          break;
      }

      // Start process
      this.start();

      callback();
    });
    this.current.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.current.updateValue(value);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);

      // For caching purpose
      this.accessory.context.current = this.current.value;

      callback();
    });
    this.target.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.target.updateValue(value);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${this.target.value}.`);

      if(value === this.current.value) return callback();

      // Start shutter
      this.state.setValue(this.target.value > this.current.value ?
        this.Characteristic.PositionState.INCREASING : this.Characteristic.PositionState.DECREASING);

      callback();
    });

    // Init shutter
    this.state.updateValue(this.Characteristic.PositionState.STOPPED);
    this.current.updateValue(current ?? DEFAULT_OVERTURE);
    this.target.updateValue(this.current.value);
  }

  /**
   * Start shutter
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
      const switches = this.platform.switches[this.context.deviceID];
      switches[TYPE.Up].state.updateValue(this.state.value === this.Characteristic.PositionState.INCREASING);
      switches[TYPE.Down].state.updateValue(this.state.value === this.Characteristic.PositionState.DECREASING);
    }

    // Launch processing
    this.context.process = setInterval(() => this.processing(), 250);

    this.platform.log.info(`[Remote ${this.context.deviceID}] Starting...`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${this.target.value}.`);
  }

  /**
   * Stop shutter
   */
  stop() {
    // Stop process
    clearInterval(this.context.process);

    // Reset switches if exists
    if(this.platform.withSwitches) {
      const switches = this.platform.switches[this.context.deviceID];
      switches[TYPE.Up].state.updateValue(false);
      switches[TYPE.Down].state.updateValue(false);
    }

    this.platform.log.info(`[Remote ${this.context.deviceID}] Stopping.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);
    this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${this.target.value}.`);
  }

  /**
   * Processing shutter
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
    this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);

    // Stop
    if (this.current.value === 100 || this.current.value === 0
      || ((this.current.value <= this.target.value && this.state.value === this.Characteristic.PositionState.DECREASING)
      || (this.current.value >= this.target.value && this.state.value === this.Characteristic.PositionState.INCREASING))
    ) this.state.setValue(this.Characteristic.PositionState.STOPPED);
  }
}