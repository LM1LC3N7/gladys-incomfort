// -----------------------------------------------------------------------------
// The real transport (node:http) against a fake gateway on loopback.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GatewayClient } from '../src/lan2rf/client.js';
import { CODES } from '../src/lan2rf/errors.js';
import { httpRequest } from '../src/lan2rf/http.js';
import { PASSWORD, SERIAL_A, USERNAME, createFakeGateway } from './helpers/fakeGateway.js';

async function server(handler) {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${s.address().port}`,
    close: () =>
      new Promise((resolve) => {
        s.closeAllConnections?.();
        s.close(resolve);
      }),
  };
}

test('an open gateway: the heater list and a boiler, over HTTP', async () => {
  const fake = createFakeGateway();
  const gateway = await fake.listen();
  try {
    const client = new GatewayClient({ origin: gateway.origin });
    assert.deepEqual(await client.heaters(), [{ index: 0, serial: SERIAL_A }]);
    const data = await client.heater(0);
    assert.equal(data.pressure, 1.74);
    assert.equal(fake.requests[0].path, '/heaterlist.json');
    assert.equal(fake.requests[1].query, '?heater=0');
    assert.equal(fake.requests[0].headers.authorization, undefined, 'no credentials: none sent');
  } finally {
    await gateway.close();
  }
});

test('a newer gateway: /protect/ and basic authentication; a wrong password is a 401', async () => {
  const fake = createFakeGateway({ protect: true });
  const gateway = await fake.listen();
  try {
    const client = new GatewayClient({
      origin: gateway.origin,
      username: USERNAME,
      password: PASSWORD,
    });
    assert.deepEqual(await client.heaters(), [{ index: 0, serial: SERIAL_A }]);
    assert.equal(fake.requests[0].path, '/protect/heaterlist.json');
    const wrong = new GatewayClient({ origin: gateway.origin, username: USERNAME, password: 'x' });
    await assert.rejects(wrong.heaters(), { code: CODES.HTTP, status: 401 });
    const none = new GatewayClient({ origin: gateway.origin });
    await assert.rejects(none.heaters(), { code: CODES.HTTP, status: 401 });
  } finally {
    await gateway.close();
  }
});

test('the setpoint request: heater, thermostat (room - 1), setpoint (T - 5) * 10', async () => {
  const fake = createFakeGateway();
  const gateway = await fake.listen();
  try {
    const client = new GatewayClient({ origin: gateway.origin });
    let sent = false;
    const data = await client.setSetpoint(0, 1, 20, {
      deadline: Date.now() + 3000,
      onSent: () => {
        sent = true;
      },
    });
    assert.equal(sent, true);
    assert.equal(fake.requests[0].query, '?heater=0&thermostat=0&setpoint=150');
    assert.equal(data.rooms[0].target, 20);
    await assert.rejects(client.setSetpoint(0, 1, 31), /out of range/);
    await assert.rejects(client.setSetpoint(0, 3, 20), /Unknown room/);
    assert.equal(fake.requests.length, 1, 'nothing sent for a value out of range');
  } finally {
    await gateway.close();
  }
});

test('the error of an HTTP status never carries the text of the answer', async () => {
  const s = await server((req, res) => {
    res.writeHead(500, { 'retry-after': '120' });
    res.end('<html>internal path /var/secret</html>');
  });
  try {
    const client = new GatewayClient({ origin: s.origin });
    const err = await client.heaters().catch((e) => e);
    assert.equal(err.code, CODES.HTTP);
    assert.equal(err.status, 500);
    assert.equal(err.message, 'HTTP 500');
    assert.equal(err.retryAfterMs, 120_000);
  } finally {
    await s.close();
  }
});

test('not JSON, too large, no answer in time', async () => {
  let mode = 'html';
  const s = await server((req, res) => {
    if (mode === 'html') res.end('<html></html>');
    else if (mode === 'large') res.end('x'.repeat(70 * 1024));
    // 'silent': never answers
  });
  try {
    const client = new GatewayClient({ origin: s.origin });
    await assert.rejects(client.heaters(), { code: CODES.BAD_ANSWER });
    mode = 'large';
    await assert.rejects(client.heaters(), { code: CODES.TOO_LARGE });
    mode = 'silent';
    await assert.rejects(
      httpRequest(`${s.origin}/heaterlist.json`, { timeout: 200, maxBytes: 1000 }),
      {
        code: CODES.TIMEOUT,
      },
    );
  } finally {
    await s.close();
  }
});

test('nobody listening: unreachable, and "not sent"', async () => {
  const s = await server(() => {});
  const { origin } = s;
  await s.close();
  const err = await httpRequest(`${origin}/heaterlist.json`, {
    timeout: 2000,
    maxBytes: 1000,
  }).catch((e) => e);
  assert.equal(err.code, CODES.UNREACHABLE);
  assert.equal(err.notSent, true);
});

test('a deadline already spent: nothing is sent', async () => {
  const fake = createFakeGateway();
  const client = new GatewayClient({ origin: 'http://192.0.2.1', request: fake.request });
  await assert.rejects(client.heaters({ deadline: Date.now() + 100 }), {
    code: CODES.NO_TIME,
    notSent: true,
  });
  await assert.rejects(client.setSetpoint(0, 1, 20, { deadline: Date.now() + 100 }), {
    code: CODES.NO_TIME,
  });
  assert.equal(fake.requests.length, 0);
});
