# Changelog

## 2.0.0

### Breaking changes

- Use `"platform": "RFXCom"` in Homebridge configuration.

- Publish under the new npm name `@kinouzero/homebridge-rfxcom-2`; this is a separate package from `homebridge-plugin-rfxcom-3`.

- Require Homebridge 2.4+ within 2.x and Node.js 22.13+ within 22.x or 24.x.
- Accept only the `rfyRemotes` array and `deviceID` device key.
- Replace `openCloseSeconds` with independent `upSeconds` and `downSeconds`, each defaulting to 25 seconds.
- Reject device entries with invalid values or unknown fields instead of applying compatibility fallbacks.
- Derive accessory UUIDs and serial numbers from `deviceID`. Old v1 accessories and cached positions are not migrated; devices start with new HomeKit identities at an estimated 50% position. Rooms, scenes and automations may need to be updated.

### Changes

- Validate and normalize device configuration once before creating accessories.
- Index configured devices by UUID for direct cache lookups and removal.
- Store only the position and reverse setting in accessory context.
- Retain configurable names, reverse mode, directional travel timing, bounded radio commands, acknowledgement handling and USB reconnection.
- Test Homebridge 2 on Node.js 22 and 24, with native-driver integration tests and mandatory 100% source coverage.

- Publish the tested npm archive on matching stable version tags after the complete CI matrix passes, using npm trusted publishing.
