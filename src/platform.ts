import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, TTY } from './settings';

import rfxcom from 'rfxcom';

import { Remote } from './Remote';

export class RFXComPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly rfyRemotes: any[] = [];

  // attributes
  public readonly tty: string = TTY;
  public readonly debug: boolean = false;
  public readonly rfxtrx: any = null;
  public readonly rfy: any = null;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log    = log;
    this.config = config || { platform: PLUGIN_NAME };
    this.tty    = this.config.tty || TTY;
    this.debug  = this.config.debug || false;

    const rfyRemotes = this.config.rfyRemotes || this.config.rfyremotes;
    this.rfyRemotes  = Array.isArray(rfyRemotes) ? rfyRemotes : [];

    this.rfxtrx = new rfxcom.RfxCom(this.tty, { debug: this.debug });
    this.rfy    = new rfxcom.Rfy(this.rfxtrx, rfxcom.rfy.RFY);

    this.rfxtrx.on('disconnect', () => this.log.debug('ERROR: RFXtrx disconnect'));
    this.rfxtrx.on('connectfailed', () => this.log.debug('ERROR: RFXtrx connect fail'));

    if(api) {
      this.api = api;      
      this.api.on('didFinishLaunching', () => this.discoverDevices());
    }
  }

   /**
   * Load accessory from cache
   * @param {PlatformAccessory} accessory
   */
  configureAccessory(accessory: PlatformAccessory) {
    if(!accessory) return;

    let id = accessory.context.id;

    this.log.info(`Loaded from cache: ${accessory.context.name} (${id})`);

    const existing = this.accessories[id];
    if(existing) this.removeAccessory(existing);

    this.accessories[id] = accessory;
  }

  /**
   * Remove an accessory
   * @param {PlatformAccessory} accessory
   */
  removeAccessory(accessory: PlatformAccessory) {
    if(!accessory) return;

    this.log.info(`${accessory.context.name} removed from HomeBridge.`);

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
   * Discover remotes
   */
  discoverDevices() {
    // Add or update accessory in HomeKit
    if(this.rfyRemotes.length) {
      // Compare local config against RFXCom-registered remotes
      this.listRemotes()
        .then(deviceRemotes => {
          if(this.debug) this.log.debug(`Received ${deviceRemotes.length} remote(s) from device`);

          this.rfyRemotes.forEach(rfyRemote => {
            // Handle different capitalizations of deviceID
            const deviceID = rfyRemote.deviceID = rfyRemote.deviceID ?? rfyRemote.deviceId;
            const device   = deviceRemotes.find(dR => deviceID === dR.deviceId);

            if(device) {
              // Remote found on the RFXCom device
              new Remote(this, rfyRemote, device);
            } else {
              // No remote found on device
              const msg = deviceRemotes.map(dR => `${dR.deviceId}`).join(', ');
              this.log.debug(`ERROR: RFY remote ${deviceID} not found. Found: ${msg}`);
            }
          })
        })
        .catch(error => {
          this.log.debug(`UNHANDLED ERROR : ${error}`);
          if(this.debug) console.log(error.stack);
        })
    } else {
      this.log.debug(`WARNING: No RFY remotes configured`);
      this.removeAccessories();
    }
  }

  /**
   * List remotes from RFXtrx
   */
   listRemotes(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.rfxtrx.once('rfyremoteslist', (remotes: any[]) => resolve(remotes));

      this.rfxtrx.initialise(() => {
        if(this.debug) this.log.debug('RFXtrx initialized, listing remotes...');
        this.rfy.listRemotes();
      })
    })
  }
}
