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
    interval: null,
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
    // Set accessory context
    this.accessory.context.id = this.context.id;
    this.accessory.context.name = this.context.name;

    // Set accessory informations
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.Characteristic.Model, 'RFY')
      .setCharacteristic(this.Characteristic.SerialNumber, `${this.context.deviceID}/${this.context.duration}/Shutter`);

    // Get accessory service
    const service = this.accessory.getService(this.platform.Service.WindowCovering)
      || this.accessory.addService(this.platform.Service.WindowCovering);

    // Get accessory characteristics
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
      // Set shutter state
      if (value > this.current.value) this.state.setValue(this.Characteristic.PositionState.INCREASING);
      else if (value < this.current.value) this.state.setValue(this.Characteristic.PositionState.DECREASING);

      if (this.state.value === this.Characteristic.PositionState.STOPPED ||
        (this.state.value === this.Characteristic.PositionState.INCREASING && this.current.value === 100) ||
        (this.state.value === this.Characteristic.PositionState.DECREASING && this.current.value === 0)
      ) {
        this.state.setValue(this.Characteristic.PositionState.STOPPED);
        return callback();
      }

      // Set switches
      if(this.platform.withSwitches) {
        const switches = this.platform.switches[this.context.deviceID];
        switches[TYPE.Up].state.updateValue(this.state.value === this.Characteristic.PositionState.INCREASING);
        switches[TYPE.Down].state.updateValue(this.state.value === this.Characteristic.PositionState.DECREASING);
      }

      // RFY commands
      if(this.state.value === this.Characteristic.PositionState.INCREASING) this.platform.rfy.up(this.context.deviceID);
      else if(this.state.value === this.Characteristic.PositionState.DECREASING) this.platform.rfy.down(this.context.deviceID);

      // Start shutter
      this.context.interval = setInterval(() => {
        // Set current position
        let current:any = this.current.value;
        if(this.state.value === this.Characteristic.PositionState.INCREASING) current += (100 / this.context.duration) / 2;
        else if(this.state.value === this.Characteristic.PositionState.DECREASING) current -= (100 / this.context.duration) / 2;
        if(current > 100) current = 100;
        if(current < 0) current = 0;
        this.current.setValue(current);
        this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);

        // Stop shutter
        if (this.current.value === 100 || this.current.value === 0 ||
          (this.current.value <= value && this.state.value === this.Characteristic.PositionState.DECREASING) ||
          (this.current.value >= value && this.state.value === this.Characteristic.PositionState.INCREASING)
        ) {
          this.state.setValue(this.Characteristic.PositionState.STOPPED);
          this.current.setValue(Math.round(this.current.value));
          this.target.updateValue(this.current.value);

          // RFY stop command
          if (this.current.value < 100 && this.current.value > 0) this.platform.rfy.stop(this.context.deviceID);

          // Clear interval
          if (this.context.interval) clearInterval(this.context.interval);

          // Reset switches
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
      }, 500);

      this.platform.log.info(`[Remote ${this.context.deviceID}] Starting...`);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] state=${this.state.value}.`);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] current=${this.current.value}.`);
      this.platform.log.debug(`[Remote ${this.context.deviceID}] target=${value}.`);

      callback();
    });

    // Init shutter
    this.state.setValue(this.Characteristic.PositionState.STOPPED);
    this.current.setValue(current ?? DEFAULT_OVERTURE);
    this.target.updateValue(this.current.value);
  }
}