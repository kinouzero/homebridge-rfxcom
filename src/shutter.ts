// Homebridge
import { CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory } from 'homebridge';
// Settings
import { PLUGIN_NAME, OPEN_CLOSE_SECONDS, TYPE } from './settings';
// Platform
import { RFXComPlatform } from './platform';
// Process
import { Process } from './process';

/**
 * Shutter accessory
 */
export class ShutterAccessory {
  /**
   * Context
   */
  private readonly context: any = {
    id: `${this.remote.deviceID}/${TYPE.Shutter}`,
    name: `${this.remote.name} ${TYPE.Shutter}`,
    deviceID: this.remote.deviceID,
    positionState: this.platform.Characteristic.PositionState.STOPPED,
    currentPosition: 50,
    targetPosition: 50,
    duration: OPEN_CLOSE_SECONDS,
    timeout: null,
    process: null,
  };

  /**
   * Constructor
   * @param {RFXComPlatform} platform
   * @param {PlatformAccessory} accessory
   * @param {any} remote
   * @param {any} device
   */
  constructor(
    private readonly platform: RFXComPlatform,
    public accessory: PlatformAccessory,
    private remote: any,
  ) {
    // Set context
    this.accessory.context = this.context;

    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.platform.Characteristic.Model, 'RFY')
      .setCharacteristic(this.platform.Characteristic.SerialNumber,
        `${this.remote.deviceID}/Shutter`);

    // Set service
    const service = this.accessory.getService(this.platform.Service.WindowCovering)
      || this.accessory.addService(this.platform.Service.WindowCovering);

    // Set event listeners
    service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));
    service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(this.getPositionState.bind(this));
    service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onGet(this.getTargetPosition.bind(this))
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (this.accessory.context.currentPosition === value) return callback();

        // New process
        const process = new Process(this.platform, this.remote);

        // Set shutter
        this.setPositionState(value > this.accessory.context.currentPosition ?
          this.platform.Characteristic.PositionState.INCREASING : this.platform.Characteristic.PositionState.DECREASING);
        this.setTargetPosition(value);

        // Start process
        process.start();

        callback();
      });
  }

  /**
   * Get position state
   * @return {Promise<CharacteristicValue>}
   */
  async getPositionState(): Promise<CharacteristicValue> {
    return this.accessory.context.positionState;
  }

  /**
   * Set position state
   * @param {CharacteristicValue} value 0: Decreasing | 1: Increasing | 2: Stopped
   */
  async setPositionState(value: CharacteristicValue) {
    this.accessory.context.positionState = value ?? this.accessory.context.positionState as number;
    if (this.platform.debug)
      this.platform.log.debug(`Remote ${this.accessory.context.deviceID}: Set ${this.accessory.context.name}, positionState=${value}.`);
  }

  /**
   * Get current position
   * @return {Promise<CharacteristicValue>}
   */
  async getCurrentPosition(): Promise<CharacteristicValue> {
    return this.accessory.context.currentPosition;
  }

  /**
   * Set current position
   * @param {CharacteristicValue} value between 0 and 100
   */
  async setCurrentPosition(value: CharacteristicValue) {
    // Check value boundaries
    if (value > 100) value = 100;
    else if (value < 0) value = 0;

    this.accessory.context.currentPosition = value ?? this.accessory.context.currentPosition as number;
    if (this.platform.debug)
      this.platform.log.debug(`Remote ${this.accessory.context.deviceID}: Set ${this.accessory.context.name}, currentPosition=${value}.`);
  }

  /**
   * Get target position
   * @return {Promise<CharacteristicValue>}
   */
  async getTargetPosition(): Promise<CharacteristicValue> {
    return this.accessory.context.targetPosition;
  }

  /**
   * Set target position
   * @param {CharacteristicValue} value between 0 and 100
   */
  async setTargetPosition(value: CharacteristicValue) {
    // Check value boundaries
    if (value > 100) value = 100;
    else if (value < 0) value = 0;

    this.accessory.context.targetPosition = value ?? this.accessory.context.targetPosition as number;
    if (this.platform.debug)
      this.platform.log.debug(`Remote ${this.accessory.context.deviceID}: Set ${this.accessory.context.name}, targetPosition=${value}.`);
  }
}