import { API, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, DynamicPlatformPlugin } from 'homebridge';
import rfxcom = require('rfxcom');
import {
  PLATFORM_NAME, PLUGIN_NAME, TTY, DEFAULT_TRAVEL_SECONDS, DISCOVERY_TIMEOUT_MS, RECONNECT_INITIAL_MS, RECONNECT_MAX_MS,
} from './settings';
import { Shutter } from './shutter';
import { RadioCommands } from './radioCommands';
import { asError, Remote } from './types';

const REMOTE_OPTIONS = new Set(['deviceID', 'name', 'upSeconds', 'downSeconds', 'reverse']);
const DEVICE_ID_PATTERN = /^0x(?!0+\/)(?:0[0-9a-fA-F]{5}|[0-9a-fA-F]{1,5})\/[0-4]$/;

export class RFXComPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: Record<string, PlatformAccessory> = Object.create(null);
  public readonly shutter: Record<string, Shutter> = Object.create(null);
  public readonly remotes: Remote[] = [];
  public readonly debug: boolean = this.config.debug ?? false;
  public commands!: RadioCommands;
  private readonly remotesByUUID = new Map<string, Remote>();
  private rfxtrx!: rfxcom.RfxCom;
  private rfy!: rfxcom.Rfy;
  private discovery?: Promise<rfxcom.RfyRemote[]>;
  private cancelDiscovery?: (error: Error) => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = RECONNECT_INITIAL_MS;
  private initialized = false;
  private failed = false;
  private closed = false;

  public get online(): boolean {
    return this.initialized && !this.failed && !this.closed;
  }

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig = { platform: PLATFORM_NAME },
    public readonly api: API,
  ) {
    const configured = this.config.rfyRemotes;
    const seen = new Set<string>();
    for (const entry of Array.isArray(configured) ? configured : []) {
      const { deviceID, name, upSeconds = DEFAULT_TRAVEL_SECONDS, downSeconds = DEFAULT_TRAVEL_SECONDS, reverse = false } = entry ?? {};
      if (typeof deviceID !== 'string' || !DEVICE_ID_PATTERN.test(deviceID) ||
          typeof name !== 'string' || !name.trim() ||
          !Number.isFinite(upSeconds) || upSeconds <= 0 || !Number.isFinite(downSeconds) || downSeconds <= 0 ||
          typeof reverse !== 'boolean' || Object.keys(entry).some(key => !REMOTE_OPTIONS.has(key))) {
        this.log.warn('Ignoring invalid RFY remote: use deviceID, name, positive upSeconds/downSeconds and boolean reverse');
        continue;
      }
      if (seen.has(deviceID)) {
        this.log.warn('Ignoring duplicate RFY remote ' + deviceID);
        continue;
      }
      seen.add(deviceID);
      const remote = Object.freeze({ deviceID, name, upSeconds, downSeconds, reverse });
      this.remotes.push(remote);
      this.remotesByUUID.set(this.api.hap.uuid.generate(deviceID), remote);
    }
    this.createConnection();
    this.api.on('didFinishLaunching', () => {
      void this.discoverRemotes();
    });
    this.api.on('shutdown', () => this.shutdown());
  }

  private createConnection(): void {
    this.commands?.dispose();
    this.initialized = false;
    this.failed = false;
    const radio = new rfxcom.RfxCom(this.config.tty ?? TTY, { debug: this.debug });
    this.rfxtrx = radio;
    this.rfy = new rfxcom.Rfy(radio, rfxcom.rfy.RFY);
    const fail = (error: unknown) => {
      if (this.rfxtrx === radio) this.connectionFailed(asError(error));
    };
    this.commands = new RadioCommands(radio, this.rfy, fail);
    radio.on('disconnect', error => fail(error ?? new Error('RFXtrx disconnected')));
    radio.on('connectfailed', error => fail(error ?? new Error('RFXtrx connection failed')));
  }

  private connectionFailed(error: Error): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.initialized = false;
    this.log.error(error.message);
    for (const shutter of Object.values(this.shutter)) shutter.setAvailable(false);
    this.commands.setConnected(false, error);
    this.cancelDiscovery?.(error);
    this.rfxtrx.close();
    if (this.remotes.length && this.reconnectTimer === undefined) {
      const delay = this.retryDelay;
      this.retryDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
      this.log.info('Retrying RFXtrx connection in ' + delay / 1000 + ' seconds');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        if (this.closed) return;
        this.createConnection();
        void this.discoverRemotes();
      }, delay);
    }
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories[accessory.UUID] = accessory;
    const remote = this.remotesByUUID.get(accessory.UUID);
    if (remote) {
      this.shutter[remote.deviceID] = new Shutter(this, accessory, remote);
      this.shutter[remote.deviceID].setAvailable(false);
    }
    this.log.info('Loaded from cache: ' + accessory.displayName);
  }

  addAccessory(remote: Remote): void {
    const uuid = this.api.hap.uuid.generate(remote.deviceID);
    const cached = this.accessories[uuid];
    const accessory = cached ?? new this.api.platformAccessory(remote.name, uuid);
    accessory.displayName = remote.name;
    if (!this.shutter[remote.deviceID])
      this.shutter[remote.deviceID] = new Shutter(this, accessory, remote);
    this.shutter[remote.deviceID].setAvailable(this.online);
    this.accessories[uuid] = accessory;
    if (cached) this.api.updatePlatformAccessories([accessory]);
    else this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  removeAccessory(accessory: PlatformAccessory): void {
    const remote = this.remotesByUUID.get(accessory.UUID);
    if (remote) {
      this.shutter[remote.deviceID]?.dispose();
      delete this.shutter[remote.deviceID];
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    delete this.accessories[accessory.UUID];
  }

  async discoverRemotes(): Promise<void> {
    if (this.closed) return;
    for (const [uuid, accessory] of Object.entries(this.accessories))
      if (!this.remotesByUUID.has(uuid)) this.removeAccessory(accessory);
    if (!this.remotes.length) {
      this.log.warn('No valid RFY remotes configured');
      return;
    }
    try {
      const available = new Set((await this.listRemotes()).map(remote => remote.deviceId));
      if (this.closed) return;
      this.retryDelay = RECONNECT_INITIAL_MS;
      this.commands.setConnected(true);
      for (const remote of this.remotes) {
        if (!available.has(remote.deviceID)) {
          this.shutter[remote.deviceID]?.setAvailable(false);
          this.log.warn('RFY remote ' + remote.deviceID + ' not found');
          continue;
        }
        this.addAccessory(remote);
      }
    } catch (error) {
      this.connectionFailed(asError(error));
    }
  }

  listRemotes(): Promise<rfxcom.RfyRemote[]> {
    if (this.closed || this.failed) return Promise.reject(new Error('RFXtrx unavailable'));
    if (this.discovery) return this.discovery;
    const radio = this.rfxtrx;
    const rfy = this.rfy;
    const operation = new Promise<rfxcom.RfyRemote[]>((resolve, reject) => {
      let settled = false;
      let sequence: number | undefined;
      const cleanup = () => {
        settled = true;
        clearTimeout(timeout);
        radio.removeListener('rfyremoteslist', onRemotes);
        radio.removeListener('connectfailed', onFailure);
        radio.removeListener('disconnect', onFailure);
        radio.removeListener('response', onResponse);
        this.cancelDiscovery = undefined;
      };
      const onFailure = (error?: unknown) => {
        if (settled) return;
        cleanup();
        reject(asError(error ?? 'RFXtrx connection failed or disconnected'));
      };
      const onResponse = (message: string, responseSequence: number, code: number) => {
        if (responseSequence === sequence && code >= 2)
          onFailure(new Error('RFXtrx rejected remote discovery (code ' + code + '): ' + message));
      };
      const onRemotes = (remotes: rfxcom.RfyRemote[]) => {
        if (settled) return;
        cleanup();
        resolve(remotes);
      };
      const timeout = setTimeout(() => onFailure(new Error('Timed out listing RFY remotes')), DISCOVERY_TIMEOUT_MS);
      this.cancelDiscovery = onFailure;
      radio.once('rfyremoteslist', onRemotes);
      radio.once('connectfailed', onFailure);
      radio.once('disconnect', onFailure);
      radio.on('response', onResponse);
      const list = () => {
        if (settled || this.closed || radio !== this.rfxtrx) return;
        this.initialized = true;
        try {
          sequence = rfy.listRemotes(error => {
            if (error) onFailure(error);
          });
          if (sequence === -1) onFailure(new Error('RFY remote listing already in progress'));
        } catch (error) {
          onFailure(error);
        }
      };
      try {
        if (this.initialized) list();
        else radio.initialise(list);
      } catch (error) {
        onFailure(error);
      }
    });
    this.discovery = operation.finally(() => {
      this.discovery = undefined;
    });
    return this.discovery;
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const shutter of Object.values(this.shutter)) shutter.dispose();
    this.cancelDiscovery?.(new Error('RFXCom platform is shut down'));
    this.commands.dispose();
    this.rfxtrx.close();
  }
}
