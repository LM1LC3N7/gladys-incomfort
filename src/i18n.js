// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. The connection status and the button answer
// are { en, fr }; errors thrown to Gladys are English (one language per
// message, like the core's); the device texts (feature names, boiler status,
// fault) follow the language chosen in the configuration.
// -----------------------------------------------------------------------------

import { CODES } from './lan2rf/errors.js';

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const plural = (n, one, many) => (n === 1 ? one : many);

/** Why the gateway failed, in a few words (codes and statuses only). */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
    case CODES.NO_TIME:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ heaters, rooms, down }) =>
      join(
        {
          en: `The gateway answers: ${heaters} ${plural(heaters, 'boiler', 'boilers')}, ${rooms} room ${plural(rooms, 'thermostat', 'thermostats')}.`,
          fr: `La passerelle répond : ${heaters} ${plural(heaters, 'chaudière', 'chaudières')}, ${rooms} ${plural(rooms, 'thermostat', 'thermostats')} de pièce.`,
        },
        down > 0
          ? {
              en: `${down} ${plural(down, 'boiler does', 'boilers do')} not answer.`,
              fr: `${down} ${plural(down, 'chaudière ne répond', 'chaudières ne répondent')} pas.`,
            }
          : {},
      ),
    noHeater: {
      en: 'The gateway answers, but no boiler is bound to it (empty heater list): check the pairing between the gateway and the boiler.',
      fr: 'La passerelle répond, mais aucune chaudière n’y est liée (liste vide) : vérifiez l’appairage entre la passerelle et la chaudière.',
    },
    hostEmpty: {
      en: 'Type the address of the Lan2RF gateway (e.g. 192.168.1.20).',
      fr: 'Saisissez l’adresse de la passerelle Lan2RF (ex. 192.168.1.20).',
    },
    hostInvalid: {
      en: 'The address of the gateway is not valid: type its IP address or host name (e.g. 192.168.1.20), without a path.',
      fr: 'L’adresse de la passerelle n’est pas valide : saisissez son adresse IP ou son nom (ex. 192.168.1.20), sans chemin.',
    },
    hostCredentials: {
      en: 'Remove the user name and password from the address: type them in their own fields.',
      fr: 'Retirez l’identifiant et le mot de passe de l’adresse : saisissez-les dans leurs propres champs.',
    },
    hostHttps: {
      en: 'The Lan2RF gateway only speaks plain http: type its address without https://.',
      fr: 'La passerelle Lan2RF ne parle qu’en http simple : saisissez son adresse sans https://.',
    },
    passwordWithoutUser: {
      en: 'A password is typed without a user name: type the user name too, or clear the password.',
      fr: 'Un mot de passe est saisi sans identifiant : saisissez aussi l’identifiant, ou videz le mot de passe.',
    },
    credentialsInvalid: {
      en: 'The user name or the password holds an invisible or non-ASCII character (copied with it?), or the user name a colon: type them again.',
      fr: 'L’identifiant ou le mot de passe contient un caractère invisible ou non ASCII (copié avec ?), ou l’identifiant un deux-points : saisissez-les de nouveau.',
    },
    authRefused: {
      en: 'The gateway refused the user name and password (HTTP 401). Gladys does not try again by itself: fix them and save, or press "Test the connection".',
      fr: 'La passerelle a refusé l’identifiant et le mot de passe (HTTP 401). Gladys ne réessaie pas seul : corrigez-les et enregistrez, ou appuyez sur « Tester la connexion ».',
    },
    authNeeded: {
      en: 'This gateway asks for a user name and password (HTTP 401): type those of the gateway (see its label or manual) and save. Gladys does not try again by itself.',
      fr: 'Cette passerelle demande un identifiant et un mot de passe (HTTP 401) : saisissez ceux de la passerelle (voir son étiquette ou sa notice) et enregistrez. Gladys ne réessaie pas seul.',
    },
    notFound: (withCredentials, delay) =>
      join(
        withCredentials
          ? {
              en: 'The gateway has no protected pages (HTTP 404): an older gateway works without a user name; clear the user name and the password.',
              fr: 'La passerelle n’a pas de pages protégées (HTTP 404) : une passerelle plus ancienne fonctionne sans identifiant ; videz l’identifiant et le mot de passe.',
            }
          : {
              en: 'This address does not answer like a Lan2RF gateway (HTTP 404): check the address; a newer gateway needs its user name and password.',
              fr: 'Cette adresse ne répond pas comme une passerelle Lan2RF (HTTP 404) : vérifiez l’adresse ; une passerelle récente demande son identifiant et son mot de passe.',
            },
        RETRY(delay),
      ),
    notGateway: (delay) =>
      join(
        {
          en: 'This address does not answer like a Lan2RF gateway: check the address and the port (80 by default).',
          fr: 'Cette adresse ne répond pas comme une passerelle Lan2RF : vérifiez l’adresse et le port (80 par défaut).',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'The gateway asks Gladys to slow down (HTTP 429): every request is paused.',
          fr: 'La passerelle demande à Gladys de ralentir (HTTP 429) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'The gateway does not answer:', fr: 'La passerelle ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ heaters, rooms }) => ({
      en: `Connected: ${heaters} ${plural(heaters, 'boiler', 'boilers')}, ${rooms} room ${plural(rooms, 'thermostat', 'thermostats')}.`,
      fr: `Connecté : ${heaters} ${plural(heaters, 'chaudière', 'chaudières')}, ${rooms} ${plural(rooms, 'thermostat', 'thermostats')} de pièce.`,
    }),
  },
  errors: {
    unknownDevice: 'Unknown device or feature: only the room setpoint can be changed',
    notConnected: 'The gateway is not connected: see the configuration of the integration',
    invalidValue: (min, max) => `Invalid setpoint: a temperature from ${min} to ${max} °C expected`,
    controlDisabled:
      'Changing the room setpoint is off: allow it first in the configuration of the integration ("Allow changing the room setpoint")',
    tooSlow:
      'The command could not be checked in time (Gladys waits 5 s for its answer): nothing was sent, try again',
    unknownState: (err) =>
      `The current state could not be read (${reasonOf(err).en}): nothing was sent`,
    unknownHeater: 'This boiler is no longer bound to the gateway: nothing was sent',
    unknownRoom: 'This room thermostat does not answer the gateway now: nothing was sent',
    notSent: (err) =>
      `The command could not reach the gateway (${reasonOf(err).en}): nothing was sent`,
    refused: (err) => `The gateway refused the command (${reasonOf(err).en})`,
    configChanged: 'The configuration changed meanwhile: nothing was sent, try again',
    busy: 'The gateway asked Gladys to slow down: nothing was sent, try again later',
    testTooLong:
      'The gateway has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};

/** Labels of the operating state (`displ_code`), from incomfort-client. */
const DISPLAY = {
  0: ['OpenTherm', 'OpenTherm'],
  15: ['External boiler', 'Ballon externe'],
  24: ['Frost protection', 'Protection antigel'],
  37: ['Central heating (RF)', 'Chauffage (RF)'],
  51: ['Hot water (internal)', 'Eau chaude (interne)'],
  85: ['Sensor test', 'Test des sondes'],
  102: ['Central heating', 'Chauffage'],
  103: ['Central heating (waiting)', 'Chauffage (attente)'],
  104: ['Central heating (low)', 'Chauffage (faible)'],
  106: ['Heat pump error recovery', 'Reprise après erreur de la pompe à chaleur'],
  126: ['Standby', 'Veille'],
  127: ['Off', 'Arrêt'],
  153: ['Post-run (hot water)', 'Post-circulation (eau chaude)'],
  170: ['Service', 'Entretien'],
  204: ['Hot water', 'Eau chaude'],
  230: ['Starting central heating', 'Démarrage du chauffage'],
  231: ['Post-run (central heating)', 'Post-circulation (chauffage)'],
  240: ['Internal boiler', 'Ballon interne'],
  255: ['Buffer', 'Ballon tampon'],
};

/** Labels of the fault codes (`displ_code` with the failure bit), from incomfort-client. */
const S1 = ['Sensor fault S1', 'Défaut de la sonde S1'];
const S2 = ['Sensor fault S2', 'Défaut de la sonde S2'];
const GAS_RELAY = ['Gas valve relay faulty', 'Relais de la vanne gaz défectueux'];
const FAULTS = {
  0: ['Sensor fault after self-check', 'Défaut de sonde après l’autotest'],
  1: ['Heating water temperature too high', 'Température de l’eau du circuit trop élevée'],
  2: ['Sensors S1 and S2 interchanged', 'Sondes S1 et S2 inversées'],
  4: ['No flame signal', 'Pas de signal de flamme'],
  5: ['Poor flame signal', 'Signal de flamme faible'],
  6: ['Flame detection fault', 'Défaut de détection de flamme'],
  8: ['Incorrect fan speed', 'Vitesse du ventilateur incorrecte'],
  10: S1,
  11: S1,
  12: S1,
  13: S1,
  14: S1,
  20: S2,
  21: S2,
  22: S2,
  23: S2,
  24: S2,
  27: ['Short circuit of the outside sensor', 'Court-circuit de la sonde extérieure'],
  29: GAS_RELAY,
  30: GAS_RELAY,
};

const TEXTS = {
  en: {
    features: {
      heater_temp: 'Heating water temperature',
      pressure: 'Heating water pressure',
      tap_temp: 'Hot water temperature',
      burning: 'Burner on',
      pumping: 'Pump on',
      tapping: 'Hot water drawn',
      failed: 'Fault (lockout)',
      status: 'Status',
      fault: 'Fault',
      temperature: 'Room temperature',
      target: 'Setpoint',
      heating: 'Heating',
    },
    heater: (serial) => `Intergas boiler ${serial}`,
    room: (number, serial) => `Room thermostat ${number} (${serial})`,
    unknownState: (code) => `Unknown state (code ${code})`,
    noFault: 'No fault',
    unknownFault: 'Unknown fault',
  },
  fr: {
    features: {
      heater_temp: 'Température de l’eau du circuit',
      pressure: 'Pression du circuit',
      tap_temp: 'Température de l’eau chaude sanitaire',
      burning: 'Brûleur allumé',
      pumping: 'Pompe en marche',
      tapping: 'Eau chaude en puisage',
      failed: 'Défaut (verrouillage)',
      status: 'État',
      fault: 'Défaut',
      temperature: 'Température de la pièce',
      target: 'Consigne',
      heating: 'Chauffe',
    },
    heater: (serial) => `Chaudière Intergas ${serial}`,
    room: (number, serial) => `Thermostat de pièce ${number} (${serial})`,
    unknownState: (code) => `État inconnu (code ${code})`,
    noFault: 'Aucun défaut',
    unknownFault: 'Défaut inconnu',
  },
};

export const texts = (language) => TEXTS[language] ?? TEXTS.en;
const index = (language) => (language === 'fr' ? 1 : 0);

/** The operating state of a boiler, in words. */
export function statusText(data, language) {
  const t = texts(language);
  if (data.failed) return faultText(data, language);
  return DISPLAY[data.displayCode]?.[index(language)] ?? t.unknownState(data.displayCode);
}

/** The fault of a boiler: `E<code> – <label>`, or "No fault". */
export function faultText(data, language) {
  const t = texts(language);
  if (!data.failed) return t.noFault;
  const label = FAULTS[data.faultCode]?.[index(language)] ?? t.unknownFault;
  return `E${data.faultCode} – ${label}`;
}
