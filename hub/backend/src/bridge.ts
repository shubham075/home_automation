// MQTT → database → WebSocket. Handles everything devices publish (docs/02-mqtt-spec.md).
import type { FastifyBaseLogger } from 'fastify';
import {
  BOOTSTRAP_HELLO_WILDCARD,
  BOOTSTRAP_RESPONSE_WILDCARD,
  ChallengeResponse,
  CmdAck,
  DEVICE_WILDCARD,
  Event,
  Hello,
  Meta,
  State,
  Status,
  Telemetry,
  parseBootstrapTopic,
  parseDevTopic,
} from '@sw6/protocol';
import { onDeviceStatus, onEndpointChanged } from './automations';
import { config } from './config';
import { db } from './db';
import { handleAck } from './commands';
import { DYNSEC_RESPONSE, ensureBrokerSetup, onDynsecMessage } from './dynsec';
import { mqttClient } from './mqtt-client';
import { onChallengeResponse, onHello } from './provisioning';
import { broadcast } from './realtime';
import { endpointViews } from './views';

type DevTopic = NonNullable<ReturnType<typeof parseDevTopic>>;

const SOURCE: Record<State['src'], string> = {
  physical: 'physical',
  cmd: 'app',
  restore: 'restore',
  local_rule: 'automation',
};

export function startBridge(log: FastifyBaseLogger) {
  // The client starts connecting at import time, so it may already be connected here;
  // without the explicit call below, the backend would never subscribe.
  const onConnect = () => {
    log.info({ url: config.MQTT_URL }, 'mqtt connected');
    mqttClient.subscribe([DEVICE_WILDCARD, BOOTSTRAP_HELLO_WILDCARD, BOOTSTRAP_RESPONSE_WILDCARD, DYNSEC_RESPONSE], { qos: 1 }, (err) => {
      if (err) return log.error({ err }, 'mqtt subscribe failed');
      ensureBrokerSetup(config.MQTT_ADMIN_USER, config.MQTT_BOOTSTRAP_PASSWORD)
        .then(() => log.info('broker roles and bootstrap login ready'))
        .catch((e) => log.error({ err: String(e) }, 'broker setup failed'));
    });
  };
  mqttClient.on('connect', onConnect);
  if (mqttClient.connected) onConnect();
  mqttClient.on('error', (err) => log.error({ err }, 'mqtt error'));
  mqttClient.on('message', (topic, buf) => {
    if (onDynsecMessage(topic, buf)) return;
    // Messages from one device are handled strictly in order (meta must land before state).
    const boot = parseBootstrapTopic(topic);
    const key = boot?.deviceId ?? parseDevTopic(topic)?.deviceId ?? topic;
    const next = (queues.get(key) ?? Promise.resolve())
      .then(() =>
        boot?.leaf === 'hello'
          ? onHello(boot.deviceId, Hello.parse(JSON.parse(buf.toString())), log)
          : boot?.leaf === 'response'
            ? onChallengeResponse(boot.deviceId, ChallengeResponse.parse(JSON.parse(buf.toString())))
            : handle(topic, buf),
      )
      .catch((err) => log.warn({ err: String(err), topic }, 'mqtt message rejected'));
    queues.set(key, next);
    void next.then(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  });
}

const queues = new Map<string, Promise<void>>();

async function handle(topic: string, buf: Buffer) {
  const t = parseDevTopic(topic);
  if (!t || buf.length === 0) return;
  const text = buf.toString();

  switch (t.leaf) {
    case 'status':
      return onStatus(t, Status.parse(text.trim()));
    case 'meta':
      return onMeta(t, Meta.parse(JSON.parse(text)));
    case 'state':
      return onState(t, State.parse(JSON.parse(text)));
    case 'cmd/ack':
      return handleAck(CmdAck.parse(JSON.parse(text)));
    case 'event':
      return onEvent(t, Event.parse(JSON.parse(text)));
    case 'telemetry':
      return onTelemetry(t, Telemetry.parse(JSON.parse(text)));
    default:
      return; // cmd, config, ota are hub → device
  }
}

/** A device may only speak for the site it is registered to. */
async function findDevice(t: DevTopic) {
  const dev = await db.device.findUnique({ where: { id: t.deviceId } });
  return dev && dev.siteId === t.siteId && !dev.deletedAt ? dev : null;
}

async function onStatus(t: DevTopic, status: Status) {
  const dev = await findDevice(t);
  if (!dev) return;
  await db.device.update({ where: { id: dev.id }, data: { status, lastSeenAt: new Date() } });
  broadcast(t.siteId, { type: 'device.status', deviceId: dev.id, online: status === 'online' });
  void onDeviceStatus(t.siteId, dev.id, status === 'online');
}

async function onMeta(t: DevTopic, meta: Meta) {
  const dev = await findDevice(t);
  if (!dev) return;

  await db.device.update({
    where: { id: dev.id },
    data: { fwVersion: meta.fw, hwRevision: meta.hw, configRevApplied: meta.cfgRev, status: 'online', lastSeenAt: new Date() },
  });
  for (const c of meta.channels.filter((c) => c.kind === 'relay')) {
    await db.endpoint.upsert({
      where: { deviceId_channel_kind: { deviceId: dev.id, channel: c.ch, kind: 'relay' } },
      create: { deviceId: dev.id, channel: c.ch, kind: 'relay', name: `Channel ${c.ch}` },
      update: {},
    });
  }
  broadcast(t.siteId, { type: 'endpoints.changed', endpoints: await endpointViews({ deviceId: dev.id }) });
}

async function onState(t: DevTopic, state: State) {
  const dev = await findDevice(t);
  if (!dev) return;

  const endpoints = await db.endpoint.findMany({ where: { deviceId: dev.id, kind: 'relay' }, include: { state: true } });
  const now = new Date();
  const changed = endpoints.filter((e) => {
    const on = state.ch[e.channel - 1];
    return on !== undefined && (e.state?.value as { on?: boolean } | null)?.on !== on;
  });

  await db.$transaction(
    changed.map((e) => {
      const value = { on: state.ch[e.channel - 1] };
      const data = { value, source: SOURCE[state.src], changedAt: now, deviceSeq: state.seq };
      return db.endpointState.upsert({ where: { endpointId: e.id }, create: { endpointId: e.id, ...data }, update: data });
    }),
  );
  if (changed.length) {
    broadcast(t.siteId, { type: 'endpoints.changed', endpoints: await endpointViews({ id: { in: changed.map((e) => e.id) } }) });
    for (const e of changed) void onEndpointChanged(t.siteId, e.id, state.ch[e.channel - 1]);
  }
}

async function onEvent(t: DevTopic, event: Event) {
  const dev = await findDevice(t);
  if (!dev) return;
  await db.auditLog.create({
    data: {
      siteId: t.siteId,
      actorType: 'device',
      actorId: dev.id,
      action: `device.event.${event.type}`,
      targetType: 'device',
      targetId: dev.id,
      data: event,
    },
  });
}

async function onTelemetry(t: DevTopic, tel: Telemetry) {
  const dev = await findDevice(t);
  if (!dev) return;
  await db.device.update({ where: { id: dev.id }, data: { rssi: tel.rssi, ipAddress: tel.ip, lastSeenAt: new Date() } });
}
