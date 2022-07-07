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
export class SwitchAccessory {
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
    private readonly direction: string,
  ) {
    // Set context
    this.accessory.context = this.context;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, 'RFY')
      .setCharacteristic(this.platform.Characteristic.SerialNumber,
        `${this.remote.deviceID}/${direction}`);

    // Set service
    const service = this.accessory.getService(this.platform.Service.Switch)
      || this.accessory.addService(this.platform.Service.Switch);

    // Set event listeners
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        const process = new Process(this.platform, this.remote);
        const shutter = this.platform.shutter[this.remote.deviceID];

        // If button is stopped
        if (!value) {
          shutter.setPositionState(this.platform.Characteristic.PositionState.STOPPED);
          shutter.setTargetPosition(shutter.accessory.context.currentPosition);
          process.stop();

          return callback();
        }

        // Set shutter
        shutter.setPositionState(direction === TYPE.Up ?
          this.platform.Characteristic.PositionState.INCREASING : this.platform.Characteristic.PositionState.DECREASING);
        shutter.setTargetPosition(direction === TYPE.Up ? 100 : 0);

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
}
