// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

export const LANGUAGES = Object.freeze(['fr', 'en']);

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  language: 'fr',
  allow_setpoint: false,
});

/** What an HTTP basic authentication header carries: printable ASCII, no colon in the user. */
const USER_PATTERN = /^[\x21-\x39\x3b-\x7e]+$/;
const PASSWORD_PATTERN = /^[\x20-\x7e]*$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

/**
 * The address of the gateway: `192.168.1.20`, `lan2rf.local`, `host:port` or
 * `http://host[:port]`. The gateway speaks plain HTTP only: https is refused
 * (said to the user rather than failing in silence). Credentials, a path, a
 * query and a fragment are refused (an address ends up in logs).
 *   -> { origin, hostname, port } or { error: 'empty' | 'invalid' | 'credentials' | 'https' }
 */
export function parseHost(value) {
  const raw = text(value);
  if (!raw) return { error: 'empty' };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === 'https') return { error: 'https' };
  if (scheme && scheme !== 'http') return { error: 'invalid' };
  let url;
  try {
    url = new URL(scheme ? raw : `http://${raw}`);
  } catch {
    return { error: 'invalid' };
  }
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || !url.hostname || url.pathname.replace(/\/+$/, '') !== '') {
    return { error: 'invalid' };
  }
  const port = url.port ? Number(url.port) : 80;
  const hostname = url.hostname.toLowerCase();
  return { origin: `http://${hostname}:${port}`, hostname, port };
}

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const host = parseHost(raw.host);
  const username = text(raw.username);
  const password = typeof raw.password === 'string' ? raw.password : '';
  const language = LANGUAGES.includes(String(raw.language))
    ? String(raw.language)
    : DEFAULTS.language;
  return {
    gateway: host.error ? null : host,
    hostError: host.error ?? null,
    username,
    password,
    // A password without a user name would be ignored in silence: said instead.
    passwordWithoutUser: !username && password !== '',
    // An invisible character pasted with the credentials (U+200B...) would make
    // Node refuse the header: said to the user, never sent.
    credentialsInvalid:
      (username !== '' && !USER_PATTERN.test(username)) || !PASSWORD_PATTERN.test(password),
    language,
    allowSetpoint: bool(raw.allow_setpoint, DEFAULTS.allow_setpoint),
  };
}

/** What a credential refusal is about (compared in memory only, never logged). */
export const credentialsKey = (config) =>
  JSON.stringify([config.gateway?.origin ?? null, config.username, config.password]);
