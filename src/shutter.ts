import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, PlatformAccessory } from 'homebridge';
import { performance } from 'perf_hooks';
import { PLUGIN_NAME, DEFAULT_POSITION } from './settings';
import type { RFXComPlatform } from './platform';
import { CommandCallback, Remote } from './types';

interface MoveRequest {
  value: number;
  callbacks: CharacteristicSetCallback[];
}

export class Shutter {
  private readonly Characteristic = this.platform.Characteristic;
  public readonly state: Characteristic;
  public readonly current: Characteristic;
  public readonly target: Characteristic;
  public readonly reverse: boolean;
  private position: number;
  private motion?: { from: number; target: number; startedAt: number; duration: number };
  private interval?: ReturnType<typeof setInterval>;
  private completion?: ReturnType<typeof setTimeout>;
  private active?: MoveRequest;
  private pending?: MoveRequest;
  private available = false;
  private fault?: Error;
  private movementVersion = 0;

  constructor(
    private readonly platform: RFXComPlatform,
    public readonly accessory: PlatformAccessory,
    private readonly remote: Remote,
  ) {
    this.reverse = remote.reverse;
    const { current, reverse } = accessory.context;
    this.position = typeof current === 'number' && Number.isFinite(current)
      ? Math.max(0, Math.min(100, current)) : DEFAULT_POSITION;
    if (typeof reverse === 'boolean' && reverse !== this.reverse) this.position = 100 - this.position;
    accessory.context = { reverse: this.reverse };
    accessory.displayName = remote.name;
    accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, PLUGIN_NAME)
      .setCharacteristic(this.Characteristic.Model, 'RFY')
      .setCharacteristic(this.Characteristic.Name, remote.name)
      .setCharacteristic(this.Characteristic.SerialNumber, remote.deviceID);
    const service = accessory.getService(this.platform.Service.WindowCovering)
      || accessory.addService(this.platform.Service.WindowCovering, remote.name);
    service.displayName = remote.name;
    service.setCharacteristic(this.Characteristic.Name, remote.name);
    this.state = service.getCharacteristic(this.Characteristic.PositionState);
    this.current = service.getCharacteristic(this.Characteristic.CurrentPosition);
    this.target = service.getCharacteristic(this.Characteristic.TargetPosition);
    this.target.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      this.move(value, callback);
    });
    for (const characteristic of [this.current, this.target, this.state])
      characteristic.onGet(() => {
        if (!this.available || this.fault)
          throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        return characteristic.value ?? 0;
      });
    this.state.updateValue(this.Characteristic.PositionState.STOPPED);
    this.publishPosition();
    this.target.updateValue(Math.round(this.position));
  }

  private publishPosition(): void {
    this.accessory.context.current = this.position;
    this.current.updateValue(Math.round(this.position));
  }

  private samplePosition(): void {
    if (!this.motion) return;
    const { from, target, startedAt, duration } = this.motion;
    const distance = Math.max(0, performance.now() - startedAt) * 100 / (duration * 1000);
    this.position = target > from ? Math.min(target, from + distance) : Math.max(target, from - distance);
    this.publishPosition();
  }

  private clearTimers(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    if (this.completion !== undefined) clearTimeout(this.completion);
    this.interval = undefined;
    this.completion = undefined;
  }

  private continueUntilWritten(): void {
    if (!this.motion) return;
    if (this.completion !== undefined) clearTimeout(this.completion);
    this.completion = undefined;
    // The previous RF movement continues until a replacement or STOP is written.
    this.motion.target = this.motion.target > this.motion.from ? 100 : 0;
  }

  private resetMotion(): void {
    this.clearTimers();
    this.motion = undefined;
    this.state.updateValue(this.Characteristic.PositionState.STOPPED);
    this.target.updateValue(Math.round(this.position));
  }

  private settle(request: MoveRequest | undefined, error?: Error | null): void {
    if (request)
      for (const callback of request.callbacks.splice(0)) callback(error);
  }

  public setAvailable(available: boolean): void {
    this.available = available;
    if (available) {
      this.fault = undefined;
      this.publishPosition();
      return;
    }
    ++this.movementVersion;
    this.samplePosition();
    this.resetMotion();
    const active = this.active;
    const pending = this.pending;
    this.active = undefined;
    this.pending = undefined;
    this.fault = new Error('RFY device unavailable');
    this.settle(active, this.fault);
    this.settle(pending, this.fault);
  }

  private move(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    if (!this.available || !this.platform.online) {
      callback(new Error('RFY device unavailable'));
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      callback(new Error('Target position must be between 0 and 100'));
      return;
    }
    const matching = this.pending?.value === value ? this.pending : !this.pending && this.active?.value === value ? this.active : undefined;
    if (matching) {
      matching.callbacks.push(callback);
      return;
    }
    if (!this.active && !this.pending && this.motion?.target === value) {
      callback();
      return;
    }
    this.settle(this.pending, new Error('Target superseded by a newer request'));
    this.pending = { value, callbacks: [callback] };
    this.drain();
  }

  private drain(): void {
    if (this.active || !this.pending) return;
    const request = this.pending;
    this.pending = undefined;
    this.active = request;
    this.samplePosition();
    let needsCorrection = false;
    const finish: CommandCallback = error => {
      if (this.active !== request) return;
      this.active = undefined;
      if (error) {
        ++this.movementVersion;
        this.samplePosition();
        this.resetMotion();
        this.fault = error;
      }
      if (!error && needsCorrection)
        if (this.pending) this.settle(request, new Error('Target superseded by a newer request'));
        else this.pending = request;
      else
        this.settle(request, error);

      this.drain();
    };
    if (!this.available || !this.platform.online) {
      finish(new Error('RFY device unavailable'));
      return;
    }
    if (request.value === this.position || (request.value > 0 && request.value < 100 && request.value === Math.round(this.position))) {
      if (this.motion) {
        this.continueUntilWritten();
        this.platform.commands.send('stop', this.remote.deviceID, () => {
          if (this.active !== request) return;
          this.samplePosition();
          this.resetMotion();
          this.fault = undefined;
        }, finish);
      } else finish();
      return;
    }
    const increasing = request.value > this.position;
    const up = this.reverse ? !increasing : increasing;
    this.continueUntilWritten();
    this.platform.commands.send(up ? 'up' : 'down', this.remote.deviceID, () => {
      if (this.active !== request) return;
      this.samplePosition();
      this.resetMotion();
      this.fault = undefined;
      const duration = up ? this.remote.upSeconds : this.remote.downSeconds;
      const version = ++this.movementVersion;
      needsCorrection = increasing !== (request.value > this.position);
      const target = needsCorrection ? (increasing ? 100 : 0) : request.value;
      this.motion = { from: this.position, target, startedAt: performance.now(), duration };
      this.state.updateValue(increasing ? this.Characteristic.PositionState.INCREASING : this.Characteristic.PositionState.DECREASING);
      this.interval = setInterval(() => this.samplePosition(), 500);
      this.completion = setTimeout(() => this.completeMovement(target, version), Math.abs(target - this.position) * duration * 10);
    }, finish);
  }

  private completeMovement(value: number, version: number): void {
    if (version !== this.movementVersion) return;
    this.samplePosition();
    this.clearTimers();
    if (value === 0 || value === 100) {
      this.resetMotion();
      return;
    }
    this.continueUntilWritten();
    this.interval = setInterval(() => this.samplePosition(), 500);
    this.platform.commands.send('stop', this.remote.deviceID, () => {
      if (version !== this.movementVersion) return;
      this.samplePosition();
      this.resetMotion();
    }, error => {
      if (error && version === this.movementVersion) {
        this.resetMotion();
        this.fault = error;
        this.platform.log.error('RFY stop failed for ' + this.remote.deviceID + ': ' + error.message);
      }
    });
  }

  public stop(callback: CommandCallback = error => {
    if (error) this.platform.log.error('RFY stop failed: ' + error.message);
  }): void {
    if (!this.available || !this.platform.online) {
      callback(new Error('RFY device unavailable'));
      return;
    }
    const moving = this.motion !== undefined || this.active !== undefined;
    const active = this.active;
    const pending = this.pending;
    this.active = undefined;
    this.pending = undefined;
    this.settle(active, new Error('Movement stopped'));
    this.settle(pending, new Error('Movement stopped'));
    const version = ++this.movementVersion;
    if (!moving) {
      callback();
      return;
    }
    this.continueUntilWritten();
    this.platform.commands.send('stop', this.remote.deviceID, () => {
      if (version !== this.movementVersion) return;
      this.samplePosition();
      this.resetMotion();
    }, error => {
      if (error && version === this.movementVersion) {
        this.samplePosition();
        this.resetMotion();
        this.fault = error;
      }
      callback(error);
    });
  }

  public dispose(): void {
    this.setAvailable(false);
  }
}
