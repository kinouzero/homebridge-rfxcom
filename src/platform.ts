// Homebridge
import { API, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, IndependentPlatformPlugin } from 'homebridge';
// Settings
import { PLATFORM_NAME, PLUGIN_NAME, TTY, TYPE } from './settings';
// Rfxcom API
import rfxcom from 'rfxcom';
// Accessories
import { ShutterAccessoryPlugin } from './shutter';
import { SwitchAccessoryPlugin } from './switch';

/**
 * RFXCom platform to interact with Somfy/Simu RTS shutters
 */
export class RFXComPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // This is used to track restored cached accessories
  public accessories: PlatformAccessory[] = [];
  // Store Rfy remotes
  public remotes: any[] = [];
  // Store switches Up|Down plugin
  public switches: SwitchAccessoryPlugin[] = [];
  // Store shutter plugin
  public shutter!: ShutterAccessoryPlugin;

  // TTY
  public tty: string;
  // Debug mode
  public debug: boolean;
  // Rfxcom API
  public rfxtrx: any;
  // Rfxcom Rfy API
  public rfy: any;

  /**
   * Constructor
   * @param {Logger} log
   * @param {PlatformConfig} config
   * @param {API} api
   */
  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig = { platform: PLUGIN_NAME },
    public readonly api: API,
  ) {
    this.tty = this.config.tty || TTY;
    this.debug = this.config.debug || false;

    const remotes = this.config.remotes || this.config.remotes;
    this.remotes = Array.isArray(remotes) ? remotes : [];

    this.rfxtrx = new rfxcom.RfxCom(this.tty, { debug: this.debug });
    this.rfy = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY);

    this.rfxtrx.on('disconnect', () => this.log.info('ERROR: RFXtrx disconnect'));
    this.rfxtrx.on('connectfailed', () => this.log.info('ERROR: RFXtrx connect fail'));

    if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', () => this.discoverDevices());
    }
  }

  /**
  * Load accessory from cache
  * @param {PlatformAccessory} accessory
  */
  configureAccessory(accessory: PlatformAccessory) {
    const id = accessory.context.id;

    this.log.info(`Loaded from cache: ${accessory.context.name} (${id})`);

    if (this.accessories[id]) this.removeAccessory(this.accessories[id]);

    this.accessories[id] = accessory;
  }

  /**
   * Remove an accessory
   * @param {PlatformAccessory} accessory
   */
  removeAccessory(accessory: PlatformAccessory) {
    this.log.info(`Removed from Homebridge: ${accessory.context.name} .`);

    this.api.unregisterPlatformAccessories(PLATFORM_NAME, PLUGIN_NAME, [accessory]);
    delete this.accessories[accessory.context.id];
  }

  /**
   * Remove all accesories
   */
  removeAccessories() {
    this.accessories.forEach((id: any) => this.removeAccessory(this.accessories[id]));
  }

  /**
   * Discover devices
   */
  discoverDevices() {
    // Add or update accessory in HomeKit
    if (this.remotes.length)
      // Compare local config against RFXCom-registered remotes
      this.listRemotes()
        .then(deviceRemotes => {
          if (this.debug) this.log.debug(`Received ${deviceRemotes.length} remote(s) from device`);

          this.remotes.forEach(remote => {
            // Handle different capitalizations of deviceID
            const deviceID = remote.deviceID = remote.deviceID ?? remote.deviceId;
            const device = deviceRemotes.find(dR => deviceID === dR.deviceId);

            if (device) {
              // Add accessories
              for (const t in TYPE) this.addAccessory(remote, device, t);
              this.log.info(`Remote ${remote.deviceID}: Added shutter and switches Up/Down.`);
            } else {
              // No remote found on device
              const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
              this.log.debug(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
            }
          });
        })
        .catch(error => {
          this.log.info(`UNHANDLED ERROR : ${error}`);
          if (this.debug) this.log.debug(error.stack);
        });
    else {
      this.log.info('WARNING: No RFY remotes configured');
      this.removeAccessories();
    }
  }

  /**
   * List remotes from RFXtrx
   */
  listRemotes(): Promise<any[]> {
    return new Promise((resolve) => {
      this.rfxtrx.once('remoteslist', (remotes: any[]) => resolve(remotes));

      this.rfxtrx.initialise(() => {
        if (this.debug) this.log.debug('RFXtrx initialized, listing remotes...');
        this.rfy.listRemotes();
      });
    });
  }

  /**
   * Add accessory to the platform
   * @param {any} remote
   * @param {any} device
   * @param {string} type Shutter|Up|Down
   */
  addAccessory(remote: any, device: any, type: string) {
    // Check if accessory already exist in cache
    const id = `${remote.deviceID}/${type}`;
    const name = `${remote.name} ${type}`;
    const uuid = this.api.hap.uuid.generate(id);

    // If yes remove it
    if (this.accessories[id]) this.removeAccessory(this.accessories[id]);

    // Create platform accessory
    const accessory = new this.api.platformAccessory(name, uuid);
    if (this.debug) this.log.debug(`Remote ${remote.deviceID}: Adding ${name} (${id}) uuid=${uuid}...`);

    // Create new accessory
    switch (type) {
      case TYPE.Shutter:
        this.shutter = new ShutterAccessoryPlugin(this, accessory, remote, device);
        break;
      case TYPE.Up:
      case TYPE.Down:
        this.switches[type] = new SwitchAccessoryPlugin(this, accessory, remote, device, type);
        break;
    }

    // Register platform accessory
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories[id] = accessory;
  }
}