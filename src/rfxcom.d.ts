declare module 'rfxcom' {
  import { EventEmitter } from 'events';
  export interface RfyRemote { deviceId: string }
  export class RfxCom extends EventEmitter {
    constructor(device: string, options: { debug: boolean });
    initialise(callback: () => void): void;
    close(): void;
  }
  type Callback = (error?: Error | null, response?: unknown, sequence?: number) => void;
  export class Rfy {
    constructor(device: RfxCom, subtype: number);
    listRemotes(callback?: Callback): number;
    up(deviceID: string, callback?: Callback): number;
    down(deviceID: string, callback?: Callback): number;
    stop(deviceID: string, callback?: Callback): number;
  }
  export const rfy: { RFY: number };
}
