// A fake SW6 that follows the same MQTT contract as the firmware will.
import mqtt, { type MqttClient } from 'mqtt';
import {
  Cmd,
  Creds,
  bootstrapTopic,
  devTopic,
  deviceIdFor,
  type CmdAck,
  type Hello,
  type Leaf,
  type Meta,
  type State,
} from '@sw6/protocol';
import type { CredsStore } from './creds-store';

const CHANNELS = 6;
const HELLO_RETRY_MS = 35_000; // a little longer than the hub's per-device cooldown

export class SimDevice {
  readonly id: string;
  private siteId = '';
  private client: MqttClient | null = null;
  private relays: boolean[] = Array(CHANNELS).fill(false);
  private seq = 0;
  private recentCids: string[] = [];
  private telemetryTimer: NodeJS.Timeout | null = null;
  private readonly bootAt = Date.now();

  constructor(
    private readonly url: string,
    readonly mac: string,
    private readonly bootstrapPassword: string,
    private readonly store: CredsStore,
    private readonly log: (msg: string) => void,
  ) {
    this.id = deviceIdFor('SW6', mac);
  }

  get online() {
    return this.client?.connected ?? false;
  }

  get relayStates() {
    return [...this.relays];
  }

  /** Like firmware boot: use stored credentials if we have them, otherwise bootstrap. */
  connect() {
    const creds = this.store.get(this.id);
    if (creds) this.connectAsDevice(creds);
    else this.bootstrap();
  }

  /** Shared "bootstrap" login: announce ourselves, wait for our own credentials. */
  private bootstrap() {
    this.log(`${this.id} has no credentials, bootstrapping`);
    const client = mqtt.connect(this.url, {
      clientId: this.id,
      username: 'bootstrap',
      password: this.bootstrapPassword,
      clean: true,
      reconnectPeriod: 5000,
    });
    this.client = client;
    let helloTimer: NodeJS.Timeout | undefined;
    const sayHello = () => {
      const hello: Hello = { v: 1, model: 'SW6', mac: this.mac, fw: '0.1.0-sim', ts: Date.now() };
      client.publish(bootstrapTopic(this.id, 'hello'), JSON.stringify(hello), { qos: 1 });
    };
    client.on('connect', () => {
      client.subscribe(bootstrapTopic(this.id, 'creds'), { qos: 1 }, () => {
        sayHello();
        clearInterval(helloTimer);
        helloTimer = setInterval(sayHello, HELLO_RETRY_MS);
      });
    });
    client.on('message', (_t, buf) => {
      const creds = Creds.safeParse(JSON.parse(buf.toString()));
      if (!creds.success || creds.data.username !== this.id) return;
      clearInterval(helloTimer);
      this.store.set(this.id, creds.data);
      this.log(`${this.id} received its own login for site "${creds.data.siteId}"`);
      client.end(true, () => this.connectAsDevice(creds.data));
    });
    client.on('error', (err) => this.log(`${this.id} bootstrap error: ${err.message}`));
  }

  private connectAsDevice(creds: Creds) {
    this.siteId = creds.siteId;
    const topic = (leaf: Leaf) => devTopic(this.siteId, this.id, leaf);
    this.client = mqtt.connect(this.url, {
      clientId: this.id,
      username: creds.username,
      password: creds.password,
      clean: false,
      keepalive: 30,
      reconnectPeriod: 1000,
      will: { topic: topic('status'), payload: Buffer.from('offline'), qos: 1, retain: true },
    });
    this.client.on('error', (err: Error & { code?: number }) => {
      // 4 = bad username/password, 5 = not authorised (v3.1.1): our login was revoked or replaced.
      if (err.code === 4 || err.code === 5) {
        this.log(`${this.id} login rejected, discarding stored credentials`);
        this.store.delete(this.id);
        this.client?.end(true);
        this.bootstrap();
      }
    });
    this.client.on('connect', () => {
      this.log(`${this.id} connected`);
      this.pub('status', 'online', true);
      this.pub('meta', this.meta(), true);
      this.publishState('restore', []);
      this.client!.subscribe([topic('cmd'), topic('config')], { qos: 1 });
      this.telemetryTimer ??= setInterval(() => this.publishTelemetry(), 60_000);
      this.publishTelemetry();
    });
    this.client.on('message', (t, buf) => {
      if (t === topic('cmd')) this.onCmd(buf.toString());
    });
  }

  /** Simulates the Wi-Fi dropping: no clean disconnect, so the broker fires the Last Will. */
  dropOffline() {
    if (!this.client) return;
    this.client.stream.destroy();
    this.client.end(true);
    this.client = null;
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.log(`${this.id} dropped offline (wall switches still work)`);
  }

  /** A wall-switch flip: relay toggles locally first, network second (principle P1). */
  physicalToggle(ch: number) {
    this.relays[ch - 1] = !this.relays[ch - 1];
    this.log(`${this.id} wall switch S${ch} → relay ${ch} ${this.relays[ch - 1] ? 'ON' : 'OFF'}`);
    if (!this.online) return;
    this.pub('event', { v: 1, type: 'input', ch, edge: this.relays[ch - 1] ? 'on' : 'off', ts: Date.now() });
    this.publishState('physical', [ch]);
  }

  stop() {
    this.client?.end();
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
  }

  private onCmd(raw: string) {
    let cmd: Cmd;
    try {
      cmd = Cmd.parse(JSON.parse(raw));
    } catch {
      return; // malformed: a real device ignores it too
    }
    if (this.recentCids.includes(cmd.cid)) return this.ack(cmd.cid, true); // duplicate retry
    this.recentCids = [...this.recentCids.slice(-15), cmd.cid];

    const changed: number[] = [];
    const set = (ch: number, on: boolean) => {
      if (ch < 1 || ch > CHANNELS) return false;
      if (this.relays[ch - 1] !== on) changed.push(ch);
      this.relays[ch - 1] = on;
      return true;
    };

    let ok = true;
    switch (cmd.op) {
      case 'set':
        ok = set(cmd.ch, cmd.on);
        break;
      case 'toggle':
        ok = set(cmd.ch, !this.relays[cmd.ch - 1]);
        break;
      case 'set_many':
        cmd.ch.forEach((on, i) => on !== null && set(i + 1, on));
        break;
      case 'all_off':
        for (let i = 1; i <= CHANNELS; i++) set(i, false);
        break;
      case 'identify':
      case 'reboot':
        break;
    }
    this.ack(cmd.cid, ok, ok ? undefined : 'invalid_channel');
    if (changed.length) {
      this.log(`${this.id} cmd ${cmd.op} → relays ${this.render()}`);
      this.publishState('cmd', changed);
    }
  }

  private ack(cid: string, ok: boolean, err?: CmdAck['err']) {
    const ack: CmdAck = { v: 1, cid, ok, state: this.relayStates, err, ts: Date.now() };
    this.pub('cmd/ack', ack);
  }

  private publishState(src: State['src'], chg: number[]) {
    const state: State = { v: 1, ch: this.relayStates, src, chg, seq: this.seq++, ts: Date.now() };
    this.pub('state', state, true);
  }

  private publishTelemetry() {
    this.pub('telemetry', {
      v: 1,
      rssi: -45 - Math.round(Math.random() * 20),
      heap: 180_000 + Math.round(Math.random() * 5000),
      up: Math.round((Date.now() - this.bootAt) / 1000),
      tC: 38 + Math.round(Math.random() * 40) / 10,
      ip: '192.168.1.' + (40 + parseInt(this.mac.slice(-2), 16) % 200),
      ts: Date.now(),
    });
  }

  private meta(): Meta {
    return {
      v: 1,
      model: 'SW6',
      hw: 'sim',
      fw: '0.1.0-sim',
      mac: this.mac,
      channels: Array.from({ length: CHANNELS }, (_, i) => ({ ch: i + 1, kind: 'relay' as const, input: true, maxA: 10 })),
      caps: ['identify', 'restore_policy', 'input_mode'],
      cfgRev: 0,
      ts: Date.now(),
    };
  }

  private pub(leaf: Leaf, payload: unknown, retain = false) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.client?.publish(devTopic(this.siteId, this.id, leaf), body, { qos: leaf === 'telemetry' ? 0 : 1, retain });
  }

  render() {
    return this.relays.map((on, i) => `${i + 1}:${on ? 'ON ' : 'off'}`).join(' ');
  }
}
