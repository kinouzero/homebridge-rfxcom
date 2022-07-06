import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { PLUGIN_NAME, DIRECTION, MODE } from './settings';

import { Remote } from './Remote';
import { Process } from './Process';

export class ShutterAccessory {
  private service: Service;

  public readonly context: any = {
    positionState: this.remote.platform.Characteristic.PositionState.STOPPED,
    currentPosition: 50,
    targetPosition: 50,
  };

  public accessory !: PlatformAccessory;

  constructor(
    private readonly remote: Remote,
  ) {

    // set context
    this.context.deviceID = remote.rfyRemote.deviceID;
    this.context.id = `${remote.rfyRemote.deviceID}/Shutter`;
    this.context.name = `${remote.rfyRemote.name} Shutter`;
    this.accessory = remote.platform.accessories[this.context.id];

    // set accessory information
    remote.accessory.getService(remote.platform.Service.AccessoryInformation)!
      .setCharacteristic(remote.platform.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(remote.platform.Characteristic.Model, remote.device.remoteType)
      .setCharacteristic(remote.platform.Characteristic.SerialNumber, `${remote.rfyRemote.deviceID}-${remote.device.unitCode}-Shutter`);

    this.service = remote.accessory.getService(remote.platform.Service.WindowCovering)
                   || remote.accessory.addService(remote.platform.Service.WindowCovering);

    this.service.getCharacteristic(remote.platform.Characteristic.CurrentPosition)
      .onGet(callback => callback(null, this.context.currentPosition));
    this.service.getCharacteristic(remote.platform.Characteristic.PositionState)
      .onGet(callback => callback(null, this.context.positionState));
    this.service.getCharacteristic(remote.platform.Characteristic.TargetPosition)
      .onGet(callback => callback(null, this.context.targetPosition))
      .onSet((value, callback) => {
        if (this.context.currentPosition === value) {
          return callback();
        }

        // New process
        const process = new Process(remote);

        // Set target position
        this.setTargetPosition(value);

        // Set mode & direction
        remote.context.mode = MODE.target;
        remote.context.direction = this.context.targetPosition > this.context.currentPosition ? DIRECTION.up : DIRECTION.down;

        // Start process
        process.start();

        callback();
      });
  }

  /**
   * Set position state
   * @param {CharacteristicValue} value 0: Decreasing | 1: Increasing | 2: Stopped
   */
  async setPositionState(value: CharacteristicValue) {
    if (value === null) {
      return;
    }

    this.context.positionState = value ?? this.context.positionState as number;
    if (this.remote.platform.debug) {
      this.remote.platform.log.debug(`Remote ${this.context.deviceID}: Set ${this.context.name}, positionState=${value}.`);
    }
  }

  /**
   * Set current position
   * @param {CharacteristicValue} value between 0 and 100
   */
  async setCurrentPosition(value: CharacteristicValue) {
    if (value === null) {
      return;
    }

    // Check value boundaries
    if (value > 100) {
      value = 100;
    } else if (value < 0) {
      value = 0;
    }

    this.context.currentPosition = value ?? this.context.currentPosition as number;
    if (this.remote.platform.debug) {
      this.remote.platform.log.debug(`Remote ${this.context.deviceID}: Set ${this.context.name}, currentPosition=${value}.`);
    }
  }

  /**
   * Set target position
   * @param {CharacteristicValue} value between 0 and 100
   */
  async setTargetPosition(value: CharacteristicValue) {
    if (value === null) {
      return;
    }

    // Check value boundaries
    if (value > 100) {
      value = 100;
    } else if (value < 0) {
      value = 0;
    }

    this.context.targetPosition = value ?? this.context.targetPosition as number;
    if (this.remote.platform.debug) {
      this.remote.platform.log.debug(`Remote ${this.context.deviceID}: Set ${this.context.name}, targetPosition=${value}.`);
    }
  }
}