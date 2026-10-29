// Usage: pnpm sim [--count 2] [--url mqtt://localhost:1883] [--reset] [--ca hub/certs/ca.crt --url mqtts://sw6hub.local:8883] [--data dir]
// Reads MQTT_BOOTSTRAP_PASSWORD from hub/backend/.env. --reset forgets stored device logins.
// Keys (active device): 1-6 flip wall switch · o drop offline / reconnect · tab next device · s status · q quit
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SETUP_CODE_ALPHABET } from '@sw6/protocol';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CredsStore } from './creds-store';
import { SimDevice } from './device';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    url: { type: 'string', default: 'mqtt://localhost:1883' },
    reset: { type: 'boolean', default: false },
    /** CA certificate to trust for mqtts:// (the pilot hub's hub/certs/ca.crt). */
    ca: { type: 'string' },
    /** Where logins (.sim-creds.json) and setup codes (.sim-codes.json) live. */
    data: { type: 'string' },
  },
});
const dataDir = values.data ? resolve(values.data) : fileURLToPath(new URL('..', import.meta.url));
const tlsCa = values.ca ? readFileSync(values.ca) : undefined;

const bootstrapPassword = process.env.MQTT_BOOTSTRAP_PASSWORD;
if (!bootstrapPassword) {
  console.error('MQTT_BOOTSTRAP_PASSWORD missing: create hub/backend/.env from .env.example');
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
const credsPath = join(dataDir, '.sim-creds.json');
if (values.reset) rmSync(credsPath, { force: true });
const store = new CredsStore(credsPath);

// Setup codes play the role of the factory partition: generated once, kept across --reset.
const codesPath = join(dataDir, '.sim-codes.json');
const codes: Record<string, string> = existsSync(codesPath) ? JSON.parse(readFileSync(codesPath, 'utf8')) : {};
const codeFor = (mac: string) => {
  if (!codes[mac]) {
    codes[mac] = Array.from(randomBytes(8), (b) => SETUP_CODE_ALPHABET[b % SETUP_CODE_ALPHABET.length]).join('');
    writeFileSync(codesPath, JSON.stringify(codes, null, 2));
  }
  return codes[mac];
};

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const count = Math.max(1, Math.min(20, Number(values.count)));

// Stable fake MACs so restarts reuse the same device ids.
const devices = Array.from({ length: count }, (_, i) => {
  const mac = `02:5e:06:00:00:${(i + 1).toString(16).padStart(2, '0')}`;
  return new SimDevice(values.url!, mac, bootstrapPassword, store, codeFor(mac), log, tlsCa);
});
devices.forEach((d) => d.connect());

const printLabels = () => devices.forEach((d) => log(`QR label ${d.claimed ? '(claimed)  ' : '(unclaimed)'} ${d.label}`));
let active = 0;
log(`${count} simulated SW6 via ${values.url}`);
printLabels();
log('keys: 1-6 wall switch · o offline/online · tab next device · s status · l labels · q quit');

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key: string) => {
    const dev = devices[active];
    if (key === 'q' || key === '\u0003') {
      devices.forEach((d) => d.stop());
      process.exit(0);
    } else if (key >= '1' && key <= '6') {
      dev.physicalToggle(Number(key));
    } else if (key === 'o') {
      if (dev.online) dev.dropOffline();
      else dev.connect();
    } else if (key === '\t') {
      active = (active + 1) % devices.length;
      log(`active device: ${devices[active].id}`);
    } else if (key === 'l') {
      printLabels();
    } else if (key === 's') {
      devices.forEach((d, i) => log(`${i === active ? '>' : ' '} ${d.id} ${d.online ? 'online ' : 'OFFLINE'} ${d.render()}`));
    }
  });
}
