// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory } from 'homebridge';
// Settings
import { PLUGIN_NAME, TYPE } from './settings';
// Platform
import { RFXComPlatform } from './platform';

/**
 * Switch Accessory
 */
export class SwitchAccessory {
  /**
   * Characteristics
   */
  private readonly Characteristic = this.platform.Characteristic;
  public readonly state: any;

  /**
   * Context
   */
  public readonly context: any = {
    id: `${this.remote.deviceID}/${this.direction}`,
    name: `${this.remote.name} ${this.direction}`,
  };

  /**
   * Constructor
   * @param {RFXComPlatform} platform
   * @param {PlatformAccessory} accessory
   * @param {any} remote
   * @param {string} direction Up|Down
   */
  constructor(
    private readonly platform: RFXComPlatform,
    public accessory: PlatformAccessory,
    private remote: any,
    private readonly direction: string,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.Characteristic.Model, 'RFY')
      .setCharacteristic(this.Characteristic.SerialNumber,
        `${this.remote.deviceID}/${direction}`);

    // Set service
    const service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // Set context
    this.accessory.context.id = this.context.id;
    this.accessory.context.name = this.context.name;

    // Get characteristic
    this.state = service.getCharacteristic(this.Characteristic.On);

    // Set event listeners
    this.state.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      // Shutter
      const shutter = this.platform.shutter[this.remote.deviceID];

      // Set shutter
      if (!value) shutter.stop();
      else shutter.target.setValue(direction === TYPE.Up ? 100 : 0);

      callback();
    });

    this.state.updateValue(false);
  }
}
