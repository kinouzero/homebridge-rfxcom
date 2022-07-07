/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'RFXCom 3';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-plugin-rfxcom-3';

/**
 * Default tty device
 */
export const TTY = '/dev/ttyUSB0';

/**
 * Default duration
 */
export const OPEN_CLOSE_SECONDS = 25;

/**
 * Create switch accessories
 */
export const WITH_SWITCHES = false;
/**
 * Enum of types
 */
export const TYPE = {
  Shutter: 'Shutter',
  Up: 'Up',
  Down: 'Down',
};