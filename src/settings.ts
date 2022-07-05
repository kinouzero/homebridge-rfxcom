/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'RFXCom 3';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-plugin-rfxcom';

/**
 * Default tty device
 */
export const TTY = '/dev/ttyUSB0';

/**
 * Default duration
 */
export const OPEN_CLOSE_SECONDS = 25;

/**
 * Enum of directions
 */
export const DIRECTION = {
  up   : 'Up',
  down : 'Down',
  stop : 'Stop'
}

/**
 * Enum of modes
 */
export const MODE = {
  switch: 'switch',
  target: 'target'
}