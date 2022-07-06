import { OPEN_CLOSE_SECONDS, DIRECTION, MODE } from './settings';

import { RFXComPlatform } from './platform';

import { ShutterAccessory } from './ShutterAccessory';
import { SwitchAccessory } from './SwitchAccessory';

export class Remote {
  public readonly context: any = {
    timeout: null,
    process: null,
    duration: OPEN_CLOSE_SECONDS,
    direction: DIRECTION.stop,
    mode: MODE.switch,
  };

  public readonly config: any;
  public readonly log: any;
  public readonly api: any;
  public readonly debug: any;
  public readonly rfyRemote: any;

  public accessory: any;
  public shutter!: ShutterAccessory;
  public switches!: SwitchAccessory[];

  constructor(
    public readonly platform: RFXComPlatform,
    public readonly remote: any,
    public readonly device: any,
  ) {
    if (!platform || !remote || !device) {
      return;
    }

    // Init
    this.platform = platform;
    this.rfyRemote = remote;
    this.device = device;

    this.log = this.platform.log;
    this.config = this.platform.config;
    this.api = this.platform.api;
    this.debug = this.platform.debug;

    if (this.config.openCloseSeconds) {
      this.context.duration = this.config.openCloseSeconds;
    }

    // Add accessories
    this.addShutter();
    this.addSwitch(DIRECTION.up);
    this.addSwitch(DIRECTION.down);

    this.log.info(`Remote ${remote.deviceID}: Added shutter and switches Up/Down.`);
  }

  /**
   * Add shutter
   */
  addShutter() {
    // Check if accessory already exist in cache
    const shutterID = `${this.rfyRemote.deviceID}/Shutter`;
    const name = `${this.rfyRemote.name} Shutter`;
    const _shutter = this.platform.accessories[shutterID];

    // If yes remove it
    if (_shutter) {
      this.platform.removeAccessory(_shutter);
    }

    // Create platform accessory
    this.platform.accessories[shutterID] = new this.api.platformAccessory(name, this.api.hap.uuid.generate(shutterID));

    // New accessory
    this.shutter = new ShutterAccessory(this);

    // Set the initial positions
    this.shutter.setCurrentPosition(this.shutter.context.currentPosition);
    this.shutter.setTargetPosition(this.shutter.context.targetPosition);
    this.shutter.setPositionState(this.platform.Characteristic.PositionState.STOPPED);

    if (this.debug) {
      this.log.debug(`Remote ${this.rfyRemote.deviceID}: Added ${this.shutter.context.name}.`);
    }
  }

  /**
   * Add switch
   * @param {string} direction Up|Down
   */
  addSwitch(direction: string) {
    // Check if switch accessory exist in cache
    const switchID = `${this.rfyRemote.deviceID}/${direction}`;
    const name = `${this.rfyRemote.name} ${direction}`;
    const _switch = this.platform.accessories[switchID];

    // If yes remove it
    if (_switch) {
      this.platform.removeAccessory(_switch);
    }

    // Create platform accessory
    this.platform.accessories[switchID] = new this.api.platformAccessory(name, this.api.hap.uuid.generate(switchID));

    // New accessory
    this.switches[direction] = new SwitchAccessory(this, direction);

    // Set the initial positions
    this.switches[direction].setSwitch(this.switches[direction].context.on);

    if (this.debug) {
      this.log.debug(`Remote ${this.rfyRemote.deviceID}: Added ${this.switches[direction].context.name}.`);
    }
  }
}