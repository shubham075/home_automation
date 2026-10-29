// Command service: app/automation → MQTT cmd → wait for cmd/ack (docs/04-workflows.md W3).
import { ulid } from 'ulid';
import { devTopic, type Cmd, type CmdAck } from '@sw6/protocol';
import { db } from './db';
import { mqttClient } from './mqtt-client';
import { broadcast } from './realtime';

const ACK_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 2;

type Inflight = { timer: NodeJS.Timeout; topic: string; payload: string; attempts: number };
const inflight = new Map<string, Inflight>();

export class CommandError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
  ) {
    super(code);
  }
}

/**
 * Sets one endpoint. A toggle is resolved to an explicit on/off here, so a retried
 * message can never flip the relay twice.
 */
export async function sendSet(opts: { endpointId: string; on?: boolean; userId?: string; source?: string }) {
  const ep = await db.endpoint.findUnique({
    where: { id: opts.endpointId },
    include: { device: true, state: true },
  });
  const siteId = ep?.device.siteId;
  if (!ep || !siteId) throw new CommandError('endpoint_not_found', 404);
  if (ep.device.status !== 'online') throw new CommandError('device_offline', 409);

  const current = (ep.state?.value as { on?: boolean } | null)?.on ?? false;
  const on = opts.on ?? !current;
  const cid = `c_${ulid()}`;
  const cmd: Cmd = { v: 1, cid, op: 'set', ch: ep.channel, on, ts: Date.now() };

  await db.command.create({
    data: { id: cid, siteId, endpointId: ep.id, requestedById: opts.userId, source: opts.source ?? 'app', payload: cmd },
  });

  const topic = devTopic(siteId, ep.deviceId, 'cmd');
  const payload = JSON.stringify(cmd);
  // Register before publishing: a fast device can ack before the next line runs.
  inflight.set(cid, { topic, payload, attempts: 1, timer: setTimeout(() => void onTimeout(cid), ACK_TIMEOUT_MS) });
  await db.command.update({ where: { id: cid }, data: { status: 'sent', attempts: 1, sentAt: new Date() } });
  mqttClient.publish(topic, payload, { qos: 1 });

  return { cid, on };
}

async function onTimeout(cid: string) {
  const entry = inflight.get(cid);
  if (!entry) return;
  if (entry.attempts < MAX_ATTEMPTS) {
    // Same cid: the device de-duplicates, so a late first ack is harmless.
    entry.attempts += 1;
    mqttClient.publish(entry.topic, entry.payload, { qos: 1 });
    entry.timer = setTimeout(() => void onTimeout(cid), ACK_TIMEOUT_MS);
    await db.command.update({ where: { id: cid }, data: { attempts: entry.attempts } });
    return;
  }
  inflight.delete(cid);
  const row = await db.command.update({ where: { id: cid }, data: { status: 'timeout' } });
  broadcast(row.siteId, { type: 'command.result', cid, endpointId: row.endpointId, status: 'timeout' });
}

export async function handleAck(ack: CmdAck) {
  const entry = inflight.get(ack.cid);
  if (entry) {
    clearTimeout(entry.timer);
    inflight.delete(ack.cid);
  }
  const existing = await db.command.findUnique({ where: { id: ack.cid } });
  if (!existing || existing.status === 'acked') return;

  const status = ack.ok ? 'acked' : 'failed';
  const row = await db.command.update({
    where: { id: ack.cid },
    data: { status, errorCode: ack.err ?? null, ackedAt: new Date() },
  });
  broadcast(row.siteId, { type: 'command.result', cid: ack.cid, endpointId: row.endpointId, status, error: ack.err });
}
