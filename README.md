# gladys-incomfort

[Gladys Assistant](https://gladysassistant.com) external integration for
**Intergas** boilers through the local **Lan2RF** (InComfort / InTouch)
gateway: each boiler becomes a Gladys device (heating water temperature,
pressure, hot water temperature, burner, pump, hot water, fault, status and
fault in words), each room thermostat a device (room temperature, setpoint,
heating). The room setpoint is the only command, off by default; hot water is
never commanded. Local HTTP, no cloud.
**Unofficial integration, not affiliated with Intergas. Never tested on a
real gateway yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (IncomfortApp)
                 ├─ src/lan2rf/client.js   the gateway's paths, basic auth, setpoint
                 ├─ src/lan2rf/http.js     the only network access (node:http, plain HTTP)
                 ├─ src/lan2rf/parse.js    answers -> plain objects (ported from incomfort-client)
                 ├─ src/lan2rf/errors.js   error codes, credential refusal
                 ├─ src/budget.js          states per minute
                 └─ src/devices.js         boilers and rooms (pure)
```

- **Gateway**: `GET /heaterlist.json`, then `GET /data.json?heater=<index>`
  per boiler, every 30 s. With a user name, every path goes under
  `/protect/` with HTTP basic authentication (newer gateways). External ids:
  `heater:<serial>`, `room:<serial>-<1|2>`; the index in the list is read
  again at every round.
- **Failures**: a boiler that fails marks only its own devices unreachable;
  the heater list failing marks them all and retries 30 s to 10 min (never
  faster than the reading). HTTP 401 is final until the user acts (saved
  configuration, "Test the connection"), kept across reconnections to
  Gladys; HTTP 429 pauses every path (1 min to 6 h). Errors are logged as
  codes, never with the text of the answer nor the credentials.
- **Command** (`allow_setpoint`, off by default): the room setpoint only,
  5 to 30 °C (refused outside, never clamped), sent as
  `data.json?heater=<index>&thermostat=<room - 1>&setpoint=<(T - 5) * 10>`.
  The heater list and the boiler are read again just before acting; nothing
  is sent past 3.5 s after the command; Gladys is answered at most 4.3 s
  after it. Commands run one after the other. No feature is a switch.
- **Reconnection to Gladys**: everything (Discovery, states, badges, status)
  is published again; the client, a credential refusal and a 429 pause stay,
  and the reading loop does not run sooner than planned.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake gateway
(`test/helpers/fakeGateway.js`, in memory and on loopback). No test touches a
real gateway or the Internet. The decoding is checked against the test data
of incomfort-client.

## Credits

- [incomfort-client](https://github.com/zxdavb/incomfort-client) (MIT): the
  protocol of the gateway, ported to JavaScript (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- The `incomfort` integration of
  [Home Assistant](https://github.com/home-assistant/core) (Apache-2.0): how
  the setpoint and the heating action are shown.
- [gladys-portainer](https://github.com/LM1LC3N7/gladys-portainer) and
  [gladys-toshiba-ac](https://github.com/LM1LC3N7/gladys-toshiba-ac): the
  structure of the app, the retry policy and the command checks.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
