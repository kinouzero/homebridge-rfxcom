// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory } from 'homebridge';
// Settings
import { PLUGIN_NAME, TYPE } from './settings';
// Platform
import { RFXComPlatform } from './platform';
// Process
import { Process } from './process';

/**
 * Switch Accessory
 */
export class SwitchAccessoryPlugin {
  /**
   * Context
   */
  private readonly context: any = {
    id: `${this.remote.deviceID}/${this.direction}`,
    name: `${this.remote.name} ${this.direction}`,
    deviceID: this.remote.deviceID,
    on: false,
  };

  /**
   * Constructor
   * @param {RFXComPlatform} platform
   * @param {PlatformAccessory} accessory
   * @param {any} remote
   * @param {any} device
   * @param {string} direction Up|Down
   */
  constructor(
    private readonly platform: RFXComPlatform,
    public accessory: PlatformAccessory,
    private remote: any,
    private device: any,
    private readonly direction: string,
  ) {
    // Set context
    this.accessory.context = this.context;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, this.device.remoteType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber,
        `${this.remote.deviceID}-${this.device.unitCode}-${direction}`);

    // Set service
    const service = this.accessory.getService(this.platform.Service.Switch)
      || this.accessory.addService(this.platform.Service.Switch);

    // Set event listeners
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        // New process
        const process = new Process(this.platform);

        // If button is stopped
        if (!value) {
          process.stop();

          return callback();
        }

        // Set shutter
        this.platform.shutter.setPositionState(direction === TYPE.Up ?
          this.platform.Characteristic.PositionState.INCREASING : this.platform.Characteristic.PositionState.DECREASING);
        this.platform.shutter.setTargetPosition(direction === TYPE.Up ? 100 : 0);

        // Start process
        process.start();

        callback();
      });
  }

  /**
   * Get switch state
   * @return {Promise<CharacteristicValue>}
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.accessory.context.on;
  }

  /**
   * Set switch state
   * @param {CharacteristicValue} value
   */
  async setOn(value: CharacteristicValue) {
    this.accessory.context.on = value ?? this.accessory.context.on as boolean;
    if (this.platform.debug)
      this.platform.log.debug(`Remote ${this.accessory.context.deviceID}: Set ${this.accessory.context.name}, on=${value}.`);
  }

  /**
   * Reset switch after a configurable amount of time
   */
  reset() {
    clearTimeout(this.platform.shutter.accessory.context.timeout);

    // New process
    const process = new Process(this.platform);
    this.platform.shutter.accessory.context.timeout = setTimeout(
      () => process.stop(), this.platform.shutter.accessory.context.duration * 1000);
  }
}
