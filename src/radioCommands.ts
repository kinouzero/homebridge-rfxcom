import type { RfxCom, Rfy } from 'rfxcom';
import { COMMAND_TIMEOUT_MS } from './settings';
import { asError, Command, CommandCallback } from './types';

interface PendingCommand {
  response: (message: string, sequence: number, code: number) => void;
  finish: CommandCallback;
}

/** Match serial writes and transmitter acknowledgements without replaying commands. */
export class RadioCommands {
  private readonly pending = new Set<PendingCommand>();
  private connected = false;
  private readonly onResponse = (message: string, sequence: number, code: number): void => {
    for (const operation of [...this.pending]) operation.response(message, sequence, code);
  };

  constructor(
    private readonly radio: RfxCom,
    private readonly rfy: Rfy,
    private readonly onFailure: (error: Error) => void,
  ) {
    radio.on('response', this.onResponse);
  }

  setConnected(connected: boolean, error = new Error('RFXtrx unavailable')): void {
    this.connected = connected;
    if (!connected)
      for (const operation of [...this.pending]) operation.finish(error);
  }

  send(command: Command, deviceID: string, onWritten: () => void, callback: CommandCallback): void {
    if (!this.connected) {
      callback(new Error('RFXtrx unavailable'));
      return;
    }
    let settled = false;
    let submitted = false;
    let written = false;
    let accepted = false;
    let sequence: number;
    const events: Array<() => void> = [];
    // Also handle synchronous drivers/mocks before the returned sequence is known.
    const dispatch = (event: () => void) => {
      if (submitted) event();
      else events.push(event);
    };
    const finish: CommandCallback = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      this.pending.delete(operation);
      callback(error);
    };
    const failConnection = (error: Error) => {
      if (settled) return;
      this.setConnected(false, error);
      this.onFailure(error);
    };
    const operation: PendingCommand = {
      finish,
      response: (message, responseSequence, code) => dispatch(() => {
        if (settled || responseSequence !== sequence) return;
        if (code === 6)
          failConnection(new Error('RFXtrx response timeout for ' + deviceID));
        else if (code !== 0 && code !== 1)
          finish(new Error('RFXtrx rejected ' + command + ' for ' + deviceID + ' (code ' + code + '): ' + message));
        else {
          accepted = true;
          if (written) finish();
        }
      }),
    };
    const timeout = setTimeout(() => {
      failConnection(new Error('RFXtrx ' + command + ' timed out for ' + deviceID));
    }, COMMAND_TIMEOUT_MS);
    this.pending.add(operation);
    try {
      sequence = this.rfy[command](deviceID, error => dispatch(() => {
        if (settled || written) return;
        if (error) {
          failConnection(asError(error));
          return;
        }
        written = true;
        onWritten();
        if (accepted) finish();
      }));
      submitted = true;
      if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255)
        finish(new Error('Invalid RFXtrx command sequence'));
      else
        for (const event of events) event();
    } catch (error) {
      submitted = true;
      finish(asError(error));
    }
  }

  dispose(): void {
    this.setConnected(false, new Error('RFXtrx connection closed'));
    this.radio.removeListener('response', this.onResponse);
  }
}
