// Usage: pnpm sim [--count 2] [--site demo] [--url mqtt://localhost:1883]
// Keys (active device): 1-6 flip wall switch · o drop offline / reconnect · tab next device · s status · q quit
import { parseArgs } from 'node:util';
import { SimDevice } from './device';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    site: { type: 'string', default: 'demo' },
    url: { type: 'string', default: 'mqtt://localhost:1883' },
  },
});

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const count = Math.max(1, Math.min(20, Number(values.count)));

// Stable fake MACs so restarts reuse the same device ids.
const devices = Array.from({ length: count }, (_, i) => {
  const mac = `02:5e:06:00:00:${(i + 1).toString(16).padStart(2, '0')}`;
  return new SimDevice(values.url!, values.site!, mac, log);
});
devices.forEach((d) => d.connect());

let active = 0;
log(`${count} simulated SW6 on site "${values.site}" via ${values.url}`);
log('keys: 1-6 wall switch · o offline/online · tab next device · s status · q quit');

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
    } else if (key === 's') {
      devices.forEach((d, i) => log(`${i === active ? '>' : ' '} ${d.id} ${d.online ? 'online ' : 'OFFLINE'} ${d.render()}`));
    }
  });
}
