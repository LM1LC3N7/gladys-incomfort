# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-17

### Added

- First version, never tested on a real gateway: Intergas boilers through the
  local Lan2RF (InComfort / InTouch) gateway, plain HTTP, optional user name
  and password (`/protect/` paths, basic authentication) for newer gateways.
- One device per boiler, keyed by its serial: heating water temperature,
  pressure (bar), hot water temperature, burner, pump, hot water function, fault
  (read only), status and fault in words (French or English).
- One device per room thermostat: room temperature, setpoint, heating.
- Room setpoint command, off by default (`allow_setpoint`), 5 to 30 °C,
  refused outside; the state is read again just before acting, nothing is
  sent past 3.5 s; no hot water command, no switch.
- Reading every 30 s; a boiler that fails marks only its own devices
  unreachable; the gateway unreachable: every device unreachable, retried
  30 s to 10 min; credentials refused: no retry until the user acts.
- Button "Test the connection".

[Unreleased]: https://github.com/LM1LC3N7/gladys-incomfort/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-incomfort/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-incomfort/releases/tag/v0.1.1
