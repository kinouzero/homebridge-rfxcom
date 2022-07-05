import { CharacteristicValue, Service } from 'homebridge';

import { PLUGIN_NAME, DIRECTION, MODE } from './settings';

import { Remote } from './Remote';
import { Process } from './Process';

export class SwitchAccessory {
  private service: Service;

  public readonly context: any = {
    on: false
  };

  constructor(
    private readonly remote: Remote,
    private readonly direction: string
  ) {

    // set context
    this.context.deviceID = remote.rfyRemote.deviceID;
    this.context.id       = `${remote.rfyRemote.deviceID}/${direction}`;
    this.context.name     = `${remote.rfyRemote.name} ${direction}`;

    // set accessory information
    remote.accessory.getService(remote.platform.Service.AccessoryInformation)!
      .setCharacteristic(remote.platform.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(remote.platform.Characteristic.Model, remote.device.remoteType)
      .setCharacteristic(remote.platform.Characteristic.SerialNumber, `${remote.rfyRemote.deviceID}-${remote.device.unitCode}-${direction}`);

    this.service = remote.accessory.getService(remote.platform.Service.Switch) || remote.accessory.addService(remote.platform.Service.Switch);

    this.service.getCharacteristic(remote.platform.Characteristic.On)
      .onGet(callback => callback(null, this.context.on))
      .onSet((value, callback) => {
        // New process
        const process = new Process(remote);

        // If button is stopped
        if(!value) {
          process.stop();
  
          return callback();
        }
  
        // Set mode & direction
        remote.context.mode      = MODE.switch;
        remote.context.direction = direction;
  
        // Start process
        process.start();
  
        callback();
      });
  }

  /**
   * Set switch state
   * @param {CharacteristicValue} value
   */
  async setOn(value: CharacteristicValue) {    
    this.context.on = value ?? this.context.on as boolean;
    if(this.remote.platform.debug) this.remote.platform.log.debug(`Remote ${this.context.deviceID}:  Set ${this.context.name}, on=${value}.`);
  }

  /**
   * Reset switch after a configurable amount of time
   * @param {Remote} remote 
   */
   async reset(remote: Remote) {
    // New process
    const process = new Process(remote);

    clearTimeout(remote.context.timeout);

    remote.context.timeout = setTimeout(() => process.stop(), remote.context.duration * 1000);
  }
}
