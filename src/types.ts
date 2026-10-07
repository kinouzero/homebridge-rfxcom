export interface Remote {
  readonly deviceID: string;
  readonly name: string;
  readonly upSeconds: number;
  readonly downSeconds: number;
  readonly reverse: boolean;
}

export type Command = 'up' | 'down' | 'stop';
export type CommandCallback = (error?: Error | null) => void;

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
