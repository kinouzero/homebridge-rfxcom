# homebridge-rfxcom

Homebridge plugin for RFY shutters and awnings controlled through an RFXtrx433E or RFXtrx433XL transceiver.

Forked from glefand/homebridge-rfxcom, which was itself forked from jhurliman/homebridge-rfxcom.

## Supported versions and upgrade requirements

| Component | Supported versions |
| --- | --- |
| Node.js | 22.13.0 or newer within 22.x, or 24.x |
| Homebridge | 2.4.0 or newer within 2.x |
| RFXCOM library | 2.6.2 or newer within 2.x, with its SerialPort 11 dependency |

Version 2 removes compatibility with Homebridge 1 and the old configuration and cache formats.

### Breaking changes from version 1

- Use `rfyRemotes` and `deviceID` exactly. The `RfyRemotes` and `deviceId` configuration aliases are no longer read.
- Replace `openCloseSeconds` with `upSeconds` and `downSeconds`. To retain the same full travel duration in both directions, set both fields to the previous value. Each omitted direction independently defaults to 25 seconds.
- Remove `withSwitches` and all unsupported device fields. Unknown device fields or invalid values prevent that device from being registered and produce a warning.
- Accessory UUIDs are now derived directly from `deviceID`, without the old `/Shutter` suffix. Old cached accessories are removed; the devices are registered with new HomeKit identities and an initial position estimate of 50%. Reassign rooms and update affected scenes or automations after upgrading.

Version 2 cache entries retain their position across restarts. Changing a name or a travel duration keeps the same v2 accessory identity. No automatic conversion of v1 configuration or positions is performed.

## Installation and configuration

```sh
npm install -g @kinouzero/homebridge-rfxcom-2
```

Add the platform to your Homebridge configuration. Replace the example ID with the exact address of a remote already registered in the RFXtrx.

```json
{
  "platforms": [
    {
      "platform": "RFXCom",
      "name": "RFXCom",
      "tty": "/dev/ttyUSB0",
      "rfyRemotes": [
        {
          "name": "Living room",
          "deviceID": "0x000001/1",
          "upSeconds": 28.5,
          "downSeconds": 24,
          "reverse": false
        }
      ]
    }
  ]
}
```

The plugin exposes one WindowCovering accessory per configured device, using exactly its configured name.

### Platform options

| Option | Description | Default |
| --- | --- | --- |
| `name` | Platform name. | `RFXCom` |
| `tty` | Serial device path. A stable `/dev/serial/by-id/...` path can also be used. | `/dev/ttyUSB0` |
| `debug` | Enable RFXtrx library traces. Use Homebridge `-D` for platform debug messages. | `false` |
| `rfyRemotes` | Required array of devices already registered in the transceiver. An empty array exposes no devices. | — |

### Device options

| Option | Description | Default |
| --- | --- | --- |
| `name` | Required, non-empty device name, used exactly as entered. No “Shutter” suffix is added. | — |
| `deviceID` | Required RFY address/unit code, such as `0x000001/1`. Address range: 1–0xFFFFF; unit: 0–4. Use the exact ID reported by the RFXtrx. | — |
| `upSeconds` | Full travel duration for the physical RFY **Up** command. | `25` |
| `downSeconds` | Full travel duration for the physical RFY **Down** command. | `25` |
| `reverse` | Swap the directions associated with the position scale. | `false` |

Durations must be positive numbers. Fractions and values above 60 seconds are supported. Invalid duration values, a non-boolean `reverse`, or unknown device fields produce a warning and prevent that device from being registered. Configuration is validated and defaults are resolved once at startup.

Change device names and options in `config.json` or the Homebridge configuration UI, then restart Homebridge. Renaming retains the existing accessory identity.

### Reverse direction

| Setting | Movement toward 0% | Movement toward 100% |
| --- | --- | --- |
| `reverse: false` | RFY Down, using `downSeconds` | RFY Up, using `upSeconds` |
| `reverse: true` | RFY Up, using `upSeconds` | RFY Down, using `downSeconds` |

Choose the setting according to the motor and desired position mapping. Directional durations always follow the physical RFY command, independently of `reverse`.

Changing `reverse` mirrors the cached estimate once using `100 - previous position`. This does not move the motor. Without a valid cached position, the initial estimate is 50%.

## Position estimation and radio reliability

Position is estimated from elapsed time and the configured travel duration. The plugin does not measure or configure motor speed.

```text
partial travel duration = directional full travel duration × abs(target − current position) / 100
```

HomeKit displays integer positions; the estimate and cache retain fractions. The movement clock starts when the serial driver confirms writing the command, not when the request enters the queue.

Commands also wait for a matching transmitter acknowledgement. Response codes 0 and 1 are accepted; negative responses are reported to HomeKit. Confirmation by the RFXtrx does not prove that the motor moved.

Writes or acknowledgements that do not arrive within 8 seconds fail the command and reset the connection. Repeated requests for the same target are combined. If a command is already awaiting confirmation, only the latest subsequent target is retained; superseded requests receive an error.

Intermediate positions send STOP. While STOP is waiting for its serial write, the position estimate continues, so a delayed STOP can produce an estimated position beyond the requested target. At 0% and 100%, the motor's end stops stop movement. An idle STOP is avoided because it can recall the Somfy favourite position.

### Disconnection and reconnection

USB errors, serial write failures and command timeouts:

- Stop the position estimate and save its last value.
- Fail outstanding requests and report a communication error to HomeKit.
- Close the connection and discard queued commands.
- Retry after 5, 10, 20, 40, then at most 60 seconds between attempts.

A fresh connection is initialized and devices are discovered again. Discovery has a 30-second limit. Successful discovery resets the retry delay. Previous movement commands are never replayed automatically.

A configured remote missing from the transceiver stays cached but unavailable. Removed configuration entries are pruned. An empty or entirely invalid remote configuration removes all platform accessories.

On shutdown, retry, discovery and movement timers are cancelled and the serial port is closed.

## Development and validation

```sh
npm ci
npm run check
npm run test:coverage
npm run check:package
```

Install dependencies normally, including their native install scripts. The suite verifies that the real serial driver loads and handles an absent port; it does not need a USB transceiver.

| Command | Purpose |
| --- | --- |
| `npm run build` | Strict TypeScript compilation into `dist/`. |
| `npm run lint` | Source linting. |
| `npm test` | Compile and run all unit and integration tests. |
| `npm run test:native` | Build and test the real RFXCOM encoder, response parser and native driver. |
| `npm run check` | Lint, compile and test; also run before publishing. |
| `npm run test:coverage` | Require 100% line, branch and function coverage; write summary and LCOV reports to `coverage/`. Use Node.js 24. |
| `npm run check:package` | Build and verify the npm package without publishing. |

Tests obtain actual HAP-NodeJS characteristics from the installed Homebridge API, a deterministic clock, and separate simulated serial writes and radio responses. They cover configuration validation, reverse mode, directional durations, delayed and missing callbacks, ACK/NAK correlation, target changes, reconnection, v2 cache restoration, rejection of obsolete configuration and shutdown.

Separate integration tests use the installed RFXCOM library to verify Up/Down/Stop packet encoding, ACK/NAK parsing, and the distinction between writing and acknowledgement. The native driver test opens a deliberately nonexistent path in a temporary directory, so no physical device is contacted.

GitHub Actions tests Node.js 22.13.0 and 24 with the locked Homebridge 2 dependency. It installs native dependencies, checks lint, runs all tests, enforces 100% coverage on Node.js 24, and verifies npm package contents. Coverage reports are retained as artifacts. A matching version tag triggers npm publication only after all checks pass.

Development uses TypeScript 6.0, ESLint 10 with `eslint.config.mjs`, and Ajv 8. TypeScript stays on the 6.0 minor series to match the supported range of typescript-eslint. Compilation emits CommonJS targeting ES2022; the DOM type library supplies Web Crypto types required by Homebridge 2's declarations. Cleaning uses Node's filesystem API, so `rimraf` and the unused `ts-node` dependency have been removed.

For local Homebridge development, run `npm link` once, then `npm run watch` to rebuild and restart Homebridge on source changes.

## Publishing releases

The `ci.yml` workflow publishes stable releases to npm after the entire test matrix succeeds. Branch pushes, pull requests and manual workflow runs only validate the project. Only a pushed tag exactly matching `v<package.json version>` can publish, and publication is restricted to `kinouzero/homebridge-rfxcom`.

The Node.js 24 job builds, tests and checks the package, then uploads its `.tgz` archive. The publish job downloads that same archive and publishes it with lifecycle scripts disabled, without rebuilding or installing project dependencies. Tag/package/lockfile version mismatches stop the release. The npm `latest` tag is used; prerelease versions are not published by this workflow.

### First publication under a new npm name

Renaming `package.json` creates a separate npm package; it does not rename the existing registry entry or transfer its trusted publisher settings. The Homebridge platform alias `RFXCom` is independent of the npm name and remains the value to use in `config.json`.

The direct OIDC workflow assumes the package already exists and its trusted publisher is configured. For a new name, the simplest bootstrap is an authenticated first publication from your machine:

```sh
npm ci
npm run test:coverage
npm run check:package
npm login
npm publish --access public
```

Complete npm's interactive authentication prompts. This publishes the version in `package.json` (currently 2.0.0). Then configure trusted publishing below and use a new version, such as 2.0.1, for the first automated release. Pushing `v2.0.0` afterward would attempt to publish that same immutable version again.

Alternatively, npm supports creating packages through authenticated [staged publishing](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/). This workflow uses direct publication and does not perform that initial account-authenticated creation.

### One-time npm setup

In the settings of the npm package `@kinouzero/homebridge-rfxcom-2`, add a **Trusted Publisher** with these values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `kinouzero` |
| Repository | `homebridge-rfxcom` |
| Workflow filename | `ci.yml` |
| Environment | Leave empty |
| Allowed actions | Enable direct publishing with `npm publish` |

Once this trust relationship is configured, no `NPM_TOKEN` secret is required. GitHub provides a temporary OIDC identity token, which npm exchanges for short-lived publishing credentials. The publish job uses Node.js 24, npm 11 and the `id-token: write` permission for OIDC authentication. npm supplies provenance for eligible public repositories. See the [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

### Publish a version

Update `package.json`, `package-lock.json` and `CHANGELOG.md`, then commit and push the release changes. For example, after publishing 2.0.0 manually, prepare and commit version 2.0.1 and then push its matching tag:

```sh
git tag v2.0.1
git push origin v2.0.1
```

For subsequent releases, use the matching new version. Configure the trusted publisher before pushing the tag. An already published npm version cannot be overwritten; use a new version for further changes. The workflow does not create tags or change version numbers automatically.

## Limits

There is no physical position feedback. External remotes, radio latency and imperfect travel durations can desynchronize the estimate. After a disconnect, the motor may have continued moving; reconnecting restores the last saved estimate rather than claiming a measured position.

Native driver loading and missing-port handling are tested locally on Linux x64. Actual USB communication, RF transmission and motor movement still require hardware validation.

The [node-rfxcom documentation](https://github.com/rfxcom/node-rfxcom#rfxcom-system-events) describes transmitter responses and discovery.
