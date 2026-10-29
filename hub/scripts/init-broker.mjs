// Creates the Mosquitto Dynamic Security config on first run, with the backend's admin login
// from hub/backend/.env. Safe to re-run: does nothing once the file exists.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(hub, 'backend', '.env');
if (!existsSync(envFile)) {
  console.error('Missing hub/backend/.env. Copy hub/backend/.env.example first.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const user = env.MQTT_ADMIN_USER;
const password = env.MQTT_ADMIN_PASSWORD;
if (!user || !password) {
  console.error('Set MQTT_ADMIN_USER and MQTT_ADMIN_PASSWORD in hub/backend/.env');
  process.exit(1);
}

const dataDir = join(hub, 'mosquitto', 'data');
mkdirSync(dataDir, { recursive: true });
if (existsSync(join(dataDir, 'dynamic-security.json'))) {
  console.log('Broker security already initialised.');
  process.exit(0);
}

execFileSync(
  'docker',
  [
    'run', '--rm',
    '-v', `${dataDir}:/mosquitto/data`,
    'eclipse-mosquitto:2',
    'mosquitto_ctrl', 'dynsec', 'init', '/mosquitto/data/dynamic-security.json', user, password,
  ],
  { stdio: 'inherit' },
);
console.log(`Broker security initialised with admin "${user}".`);
