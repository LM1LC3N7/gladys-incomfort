# Third-party notices

This integration ports to JavaScript the logic of the projects below for
talking to the Intergas Lan2RF (InComfort) gateway. Nothing of them is
installed at runtime: they are Python, this integration is JavaScript.

## incomfort-client

<https://github.com/zxdavb/incomfort-client>, maintained at
<https://github.com/jbouwh/incomfort-client> (read at commit `7a06759`,
2026-08-11, version 0.7.1), licensed under the MIT License.

Ported in `src/lan2rf/parse.js`, `src/lan2rf/client.js` and `src/i18n.js`:
the paths of the gateway (`heaterlist.json`, `data.json?heater=`, the
`/protect/` prefix with basic authentication), the decoding of the values
(`(msb * 256 + lsb) / 100`, `0x7FFF` meaning none), the bits of the `IO`
field, the display and fault codes and their labels, the null serial
`000W00000`, the replacement of a stray backslash in the answers, the
detection of the room thermostats, and the setpoint request
(`thermostat=<room - 1>`, `setpoint=(T - 5) * 10`, 5 to 30 °C). The test data
of `test/parse.test.js` comes from its tests.

```
MIT License

Copyright (c) 2019 The Python Packaging Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

(The copyright line is the one of the project's own LICENSE file, reproduced
as it is.)

## Home Assistant, `incomfort` integration

<https://github.com/home-assistant/core/tree/dev/homeassistant/components/incomfort>
(read at commit `5cfe9aa`, 2026-10-16), licensed under the Apache License,
Version 2.0. The full text of the license is the `LICENSE` file of this
repository (the same Apache License 2.0).

Followed, without copying code: the reading every 30 seconds, the setpoint
shown as the override else the thermostat's setpoint, the room "heating"
when the burner and the pump run, the room setpoint bounds (5 to 30 °C), and
the unique ids built on the serial of the boiler (`<serial>_<room>`).

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## LM1LC3N7/gladys-portainer and LM1LC3N7/gladys-toshiba-ac

The structure of the app, the handler wiring, the retry and pause policy and
the command checks follow integrations of the same author, under the Apache
License 2.0 of this repository.
