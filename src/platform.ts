// Homebridge
import { API, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, IndependentPlatformPlugin } from 'homebridge';
// Settings
import { PLATFORM_NAME, PLUGIN_NAME, TTY, TYPE, WITH_SWITCHES } from './settings';
// Rfxcom API
import rfxcom from 'rfxcom';
// Accessories
import { ShutterAccessory } from './shutter';
import { SwitchAccessory } from './switch';

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
  public switches: any[] = [];
  // Store shutter plugin
  public shutter: any[] = [];

  // TTY
  public tty: string;
  // Debug mode
  public debug: boolean;
  // Rfxcom API
  public rfxtrx: any;
  // Rfxcom Rfy API
  public rfy: any;
  // Create switch accessories
  public withSwitches: any;

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
    this.withSwitches = this.config.withSwitches || WITH_SWITCHES;

    const remotes = this.config.rfyRemotes || this.config.RfyRemotes;
    this.remotes = Array.isArray(remotes) ? remotes : [];

    this.rfxtrx = new rfxcom.RfxCom(this.tty, { debug: this.debug });
    this.rfy = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY);

    this.rfxtrx.on('disconnect', () => this.log.info('ERROR: RFXtrx disconnect'));
    this.rfxtrx.on('connectfailed', () => this.log.info('ERROR: RFXtrx connect fail'));

    if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', () => this.discoverRemotes());
    }
  }

  /**
  * Load accessory from cache
  * @param {PlatformAccessory} accessory
  */
  configureAccessory(accessory: PlatformAccessory) {
    const id = accessory.context.id;

    this.log.info(`Loaded from cache: ${accessory.context.name} (${id})`);

    this.accessories[id] = accessory;
  }

  /**
   * Add accessory to the platform
   * @param {any} remote
   * @param {string} type Shutter|Up|Down
   */
  addAccessory(remote: any, type: string) {
    // Check if accessory already exist in cache
    const id = `${remote.deviceID}/${type}`;
    let accessory = this.accessories[id];

    // If exist remove it
    if (accessory) this.removeAccessory(accessory);

    // Create platform accessory
    const name = `${remote.name} ${type}`;
    const uuid = this.api.hap.uuid.generate(id);
    accessory = new this.api.platformAccessory(name, uuid);
    if (this.debug) this.log.debug(`Remote ${remote.deviceID}: Adding ${name} (${id}) uuid=${uuid}...`);

    // Create new accessory
    switch (type) {
      case TYPE.Shutter:
        this.shutter[remote.deviceID] = new ShutterAccessory(this, accessory, remote);
        break;
      case TYPE.Up:
      case TYPE.Down:
        if(!this.withSwitches) return;
        this.switches[remote.deviceID][type] = new SwitchAccessory(this, accessory, remote, type);
        break;
    }

    // Register platform accessory
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories[id] = accessory;

    this.log.info(`Remote ${remote.deviceID}: Added ${type}.`);
  }

  /**
   * Remove an accessory
   * @param {PlatformAccessory} accessory
   */
  removeAccessory(accessory: PlatformAccessory) {
    this.log.info(`Removed from Homebridge: ${accessory.context.name}.`);

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
  discoverRemotes() {
    // Add or update accessory in HomeKit
    if (this.remotes.length)
      // Compare local config against RFXCom-registered remotes
      this.listRemotes()
        .then(rfyRemotes => {
          if (this.debug) this.log.debug(`Received ${rfyRemotes.length} remote(s) from device`);

          this.remotes.forEach(remote => {
            // Handle different capitalizations of deviceID
            remote.deviceID = remote.deviceID ?? remote.deviceId;

            if (rfyRemotes.find(r => remote.deviceID === r.deviceId)) {
              // Add Shutter
              this.switches[remote.deviceID] = [];
              for(const t in TYPE) this.addAccessory(remote, t);
            } else {
              // No remote found on device
              const msg = rfyRemotes.map(r => `${r.deviceId}`).join(', ');
              this.log.info(`ERROR: RFY remote ${remote.deviceID} not found. Found: ${msg}`);
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
      this.rfxtrx.once('rfyremoteslist', (remotes: any[]) => resolve(remotes));

      this.rfxtrx.initialise(() => {
        if (this.debug) this.log.debug('RFXtrx initialized, listing remotes...');
        this.rfy.listRemotes();
      });
    });
  }
}