// -----------------------------------------------------------------------------
// A fake Lan2RF gateway (in memory, or on loopback through listen()): the
// local HTTP interface the integration uses. The shapes come from the API
// specification and the tests of incomfort-client (MIT); never checked
// against a real gateway (TODO.md).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, GatewayError } from '../../src/lan2rf/errors.js';

export const USERNAME = 'admin';
export const PASSWORD = 'gateway-secret';
export const SERIAL_A = '2110f25190';
export const SERIAL_B = '2303002041';

const bytes = (value) => {
  if (value === null) return [127, 255];
  const raw = Math.round(value * 100);
  return [Math.floor(raw / 256), raw % 256];
};

/** The data.json of a boiler (incomfort-client test data, HEATER_WITH_ROOMS). */
export function heaterData({
  waterTemperature = 63.12,
  tapTemperature = 50.48,
  pressure = 1.74,
  io = 0,
  code = 126,
  rooms = { 1: { temperature: 19, setpoint: 18, override: 0 } },
} = {}) {
  const data = {
    nodenr: 250,
    displ_code: code,
    IO: io,
    serial_year: 0,
    serial_month: 0,
    serial_line: 0,
    serial_sn1: 0,
    serial_sn2: 0,
    serial_sn3: 0,
    rf_message_rssi: 27,
    rfstatus_cntr: 0,
  };
  const put = (stub, value) => {
    const [msb, lsb] = bytes(value);
    data[`${stub}_msb`] = msb;
    data[`${stub}_lsb`] = lsb;
  };
  put('ch_temp', waterTemperature);
  put('tap_temp', tapTemperature);
  put('ch_pressure', pressure);
  for (const number of [1, 2]) {
    const room = rooms[number];
    put(`room_temp_${number}`, room ? room.temperature : null);
    put(`room_temp_set_${number}`, room ? room.setpoint : null);
    put(`room_set_ovr_${number}`, room ? room.override : 0);
  }
  return data;
}

export function createFakeGateway({ protect = false } = {}) {
  const fake = {
    protect,
    requests: [],
    heaterlist: [SERIAL_A, null, null, null, null, null, null, null],
    heaters: [heaterData()],
    /** path (or prefix, with its query) -> { status, headers, body } answered once. */
    failures: [],
    /** A promise the setpoint requests wait for before answering (a slow gateway). */
    setpointGate: null,
    unreachable: false,
    /** Answer the raw text of the heater list instead of JSON (a stray backslash). */
    rawHeaterList: null,
    setpoints: [],
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  });

  async function answer(url, headers) {
    const prefix = fake.protect ? '/protect/' : '/';
    if (fake.protect) {
      const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
      if (!url.pathname.startsWith('/protect/')) return json(401, 'Unauthorized');
      if (headers.authorization !== expected) return json(401, 'Unauthorized');
    }
    const full = `${url.pathname}${url.search}`;
    const failure = fake.failures.findIndex((f) => full.startsWith(f.path));
    if (failure !== -1) {
      const [f] = fake.failures.splice(failure, 1);
      return json(f.status, f.body ?? '<html>remote text</html>', f.headers ?? {});
    }
    if (url.pathname === `${prefix}heaterlist.json`) {
      if (fake.rawHeaterList) return json(200, fake.rawHeaterList);
      return json(200, { heaterlist: fake.heaterlist });
    }
    if (url.pathname === `${prefix}data.json`) {
      const index = Number(url.searchParams.get('heater'));
      const data = fake.heaters[index];
      if (!data) return json(200, heaterData({ rooms: {} }));
      if (url.searchParams.has('setpoint')) {
        const room = Number(url.searchParams.get('thermostat')) + 1;
        const setpoint = Number(url.searchParams.get('setpoint'));
        fake.setpoints.push({ index, room, setpoint });
        if (fake.setpointGate) await fake.setpointGate;
        if (fake.lateStatus) return json(fake.lateStatus, 'late failure');
        const value = setpoint / 10 + 5;
        const raw = Math.round(value * 100);
        data[`room_set_ovr_${room}_msb`] = Math.floor(raw / 256);
        data[`room_set_ovr_${room}_lsb`] = raw % 256;
      }
      return json(200, data);
    }
    return json(404, 'Not found');
  }

  /** The transport of src/lan2rf/http.js, in memory. */
  fake.request = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    fake.requests.push({ url: rawUrl, path: url.pathname, query: url.search, headers });
    if (fake.unreachable) {
      const err = new GatewayError(CODES.UNREACHABLE, 'ECONNREFUSED');
      err.notSent = true;
      throw err;
    }
    options.onSent?.();
    return answer(url, headers);
  };

  /** The same interface on a loopback HTTP server: { origin, close }. */
  fake.listen = async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', async () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        fake.requests.push({
          url: req.url,
          path: url.pathname,
          query: url.search,
          headers: req.headers,
        });
        const result = await answer(url, req.headers);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      origin: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    };
  };

  return fake;
}
