# TODO — InComfort (Intergas Lan2RF) v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (post #241).

## Status

- [x] **Milestone 1 — core** (2026-10-17): local client of the Lan2RF gateway
      (heater list, boiler data, room setpoint; `/protect/` and basic
      authentication when a user name is given), ported from incomfort-client;
      one device per boiler keyed by its serial (heating water temperature,
      pressure, hot water temperature, burner, pump, hot water, fault, status
      and fault in words), one per room thermostat (room temperature,
      setpoint, heating); reading every 30 s, a boiler failing alone, the
      gateway unreachable retried 30 s to 10 min; 401 final until a user
      action and kept across reconnections; 429 pause; room setpoint off by
      default, 5-30 °C, fresh read before acting, 3.5 s budget, answer at
      4.3 s at most; "Test the connection"; docs en/fr. Tested with unit
      tests against the SDK's fake Gladys and a fake gateway (in memory and
      on loopback), the decoding against the test data of incomfort-client.
      **Never tested on a real gateway.** No Docker on this PC: no e2e test
      in a container.
- [x] **Review corrections** (2026-10-17): "already set" decided on the
      thermostat's setpoint (stale overrides of older thermostats); states of
      a command published without delaying the answer; raw value checked
      before rounding; late 401 / 429 of a setpoint applied to every path;
      rotating state budget; `onDeviceUpdated`; bounded retry of the
      configuration on `connected`; docs on what the option allows (voice
      assistants, Thermostat service) and on `.local` names; "Hot water
      function" label.
- [ ] **Milestone 2 — real gateway** (a tester with a Lan2RF): record real
      answers as fixtures (credentials removed), fix what differs. To check
      first:
  - the credentials of newer gateways (fixed per model? printed on the
    label?) and the answer of an older gateway to `/protect/` (404 assumed);
  - the time a gateway takes to answer, with 1 boiler and with several
    (10 s timeout per request, 3.5 s budget for the two reads of a command);
  - whether the setpoint answer already carries the new override
    (`room_set_ovr_N`), and how long the thermostat takes to show it;
  - thermostats that keep the override after a change by hand (the "legacy
    setpoint status" option of Home Assistant): publish the setpoint instead?
  - concurrent requests: the reading loop and a scan (Discovery) may run
    while a command reads and sends (the command's reading drops the round,
    but the requests overlap on the gateway); serialize every request if the
    gateway does not cope;
  - the pace of the reading against a slow Lan2RF: incomfort-client waits up
    to 20 s per request; here 10 s per request, a round of 8 boilers can take
    up to 90 s (the next round waits for it): measure, and widen the interval
    if a gateway is that slow;
  - display codes not in the list (logged as "Unknown state (code N)").

## Decisions

- **Version**: 0.1.0 set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag; the first Release (patch) gives 0.1.1.
- **License**: Apache-2.0, the standard text (no person named), shipped in the
  image with `THIRD_PARTY_NOTICES.md` (full MIT notice of incomfort-client,
  Apache-2.0 of Home Assistant).
- **Setpoint bounds 5-30 °C**: those of the gateway encoding and of
  incomfort-client / Home Assistant. Room air, not water: no burn risk, so no
  lower cap; a value outside is refused (never clamped, so a wrong scene
  value does not silently become 30 °C). Rounded to 0.1 °C (the encoding's
  resolution).
- **Setpoint off by default** (`allow_setpoint`); the feature is created
  writable (read_only is fixed at creation) and the permission is checked at
  each command, when it arrives and again just before sending.
- **No hot water command, no boiler mode, no switch**: the gateway offers
  none for hot water, and the brief forbids it; the binary readings are
  `unknown`/`binary`, read only, so "turn everything off" touches nothing.
- **Fresh read before acting**: the heater list (the serial must still be at
  an index) AND the boiler data (the room must answer), both within 2.7 s of
  the command; the setpoint request must leave before 3.5 s
  (`COMMAND_BUDGET_MS`) or it is not sent. Commands are serialized globally
  (one gateway, Home Assistant runs one climate update at a time).
- **"Already set"** (nothing sent): only when the thermostat's own setpoint
  is already T AND the override is invalid or equal to T. Never on the shown
  target: an older thermostat keeps a stale override after a change by hand
  (setpoint 18, override 20, a command of 20 must be sent).
- **Answer to Gladys first**: the states of a command are published without
  waiting (a late answer shows a failure and looks like a manual override to
  the Thermostat service of the core).
- **Setpoint value**: the raw value is checked in 5-30 before rounding
  (30.04 and 4.95 refused).
- **State budget**: when a round exceeds what is left of the minute, the cut
  rotates (the next cut starts where the last one stopped).
- **Configuration unreadable on `connected`**: asked again 3 times (30 s,
  60 s, 120 s) on the app's timers, then an error is logged.
- **Setpoint shown**: the override if valid (5-30 °C), else the thermostat's
  setpoint, like Home Assistant's default. The value published after a
  command is the one the gateway answers, never the one asked.
- **Heating** (room): burner AND pump on, like Home Assistant's HVAC action;
  `thermostat`/`operating-state`, 0 idle, 1 heating, no unit.
- **Water temperatures as probes** (`temperature-sensor`/`probe`): the core
  keeps them out of the room temperature; the room temperature is `decimal`.
- **Units**: bar for the pressure (listed by the core for
  `pressure-sensor`), °C for the temperatures and the setpoint.
- **Status and fault as text** (`text`/`text`, read only, no history), in the
  language of the configuration (French by default, like gladys-toshiba-ac);
  "E<code> – <label>" or "No fault". A `fault` binary as well, for scenes.
- **External ids**: `heater:<serial>` and `room:<serial>-<1|2>` (the serial
  the gateway lists; Home Assistant uses `<serial>_<room>`). A serial must be
  4-32 letters or digits; the null serial `000W00000`, empty slots and
  duplicates are left out. The index in the list is read again at every
  round, never stored.
- **Credentials**: optional; with a user name, every path goes under
  `/protect/` (incomfort-client). A password without a user name is refused
  with a message (it would be ignored). Plain HTTP only: the gateway has no
  TLS, so `https://` is refused and the docs say the credentials cross the
  LAN in clear.
- **HTTP 401**: final until the user saves the configuration or presses
  "Test the connection"; kept in memory across reconnections to Gladys (no
  `/data` store: a restart of the container makes one new try). Without
  credentials, the status asks for them.
- **Retries**: the gateway unreachable is retried 30 s, then doubling up to
  10 min; never faster than the 30 s reading. A boiler that fails alone is
  read again at the next round only. HTTP 429 (unlikely on a LAN device):
  1 min to 6 h for every path, lifted by a user action.
- **Reconnection to Gladys** (`connected` with the same configuration): the
  client, a refusal and a pause stay; the published states and badges are
  forgotten and everything is published again; the next reading keeps its
  planned time. `disconnected` only stops the timers.
- **Logs**: codes and HTTP statuses only, never the body of an answer, the
  user name / password or the Authorization header.
- **No RSSI / node number features**: diagnostic values of little use in
  Gladys; can come later.
- **No `/data` store**: nothing needs to outlive a restart.

## Ideas (not planned)

- Boiler mode / hot water setpoint: not offered by the Lan2RF HTTP interface.
- An option to show the thermostat's own setpoint (legacy thermostats).
