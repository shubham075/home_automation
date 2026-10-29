// Device bootstrap and claim (docs/04-workflows.md W2).
// 1. A board without credentials connects as the shared "bootstrap" login and says hello.
// 2. An owner/technician scans its QR label; the app sends device id + setup code to the hub.
// 3. Proof of possession: the hub challenges the board with a nonce; the board answers
//    HMAC-SHA256(setup code, nonce:deviceId). The code itself never crosses MQTT.
// 4. On a match the hub creates the board's own broker login and sends it on its private creds topic.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import {
  bootstrapTopic,
  canManageDevices,
  devTopic,
  deviceIdFor,
  parseClaimCode,
  type Challenge,
  type Cmd,
  type Creds,
  type Hello,
  type ChallengeResponse,
} from '@sw6/protocol';
import { requireUser, siteRole } from './auth';
import { config } from './config';
import { db } from './db';
import { deleteDeviceLogin, setDeviceLogin } from './dynsec';
import { mqttClient } from './mqtt-client';
import { broadcast } from './realtime';
import { parseBody } from './topology';

const HELLO_COOLDOWN_MS = 30_000;
/** A board counts as "ready to claim" if it said hello this recently (it repeats every ~35 s). */
const SEEN_WINDOW_MS = 90_000;
const CHALLENGE_TIMEOUT_MS = 5_000;
const MAX_WRONG_CODES = 5;
const WRONG_CODE_WINDOW_MS = 10 * 60_000;

const lastIssued = new Map<string, number>();
const bootstrapSeen = new Map<string, number>();
const challenges = new Map<string, { deviceId: string; resolve: (r: ChallengeResponse | null) => void }>();
const wrongCodes = new Map<string, { count: number; first: number }>();

export class ClaimError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
  ) {
    super(code);
  }
}

// ---------- MQTT side

export async function onHello(deviceId: string, hello: Hello, log: FastifyBaseLogger) {
  if (deviceIdFor(hello.model, hello.mac) !== deviceId) throw new Error('device id does not match model and MAC');
  const model = await db.deviceModel.findUnique({ where: { sku: hello.model } });
  if (!model) throw new Error(`unknown device model ${hello.model}`);
  bootstrapSeen.set(deviceId, Date.now());

  let dev = await db.device.findUnique({ where: { id: deviceId } });
  if (dev?.deletedAt) throw new Error('device was decommissioned');
  if (!dev) {
    dev = await db.device.create({
      data: { id: deviceId, modelId: model.id, name: `${hello.model} ${hello.mac.slice(-5).replace(':', '')}`, mac: hello.mac, fwVersion: hello.fw, status: 'unclaimed' },
    });
  }

  // Dev shortcut only: approve straight into DEV_AUTO_APPROVE_SITE without a claim.
  const autoSite = config.DEV_AUTO_APPROVE_SITE;
  if (!autoSite) {
    log.info({ deviceId }, 'board waiting to be claimed');
    return;
  }
  if (Date.now() - (lastIssued.get(deviceId) ?? 0) < HELLO_COOLDOWN_MS) return;
  const siteId = dev.siteId ?? autoSite;
  const hub = await db.hub.findFirst({ where: { siteId } });
  await db.device.update({ where: { id: deviceId }, data: { siteId, hubId: hub?.id } });
  await issueDeviceCredentials(deviceId, siteId);
  log.info({ deviceId, siteId }, 'device credentials issued (dev auto-approve)');
}

export async function onChallengeResponse(deviceId: string, res: ChallengeResponse) {
  const pending = challenges.get(res.nonce);
  if (pending?.deviceId === deviceId) pending.resolve(res);
}

export async function issueDeviceCredentials(deviceId: string, siteId: string, claimedById?: string) {
  const password = randomBytes(24).toString('base64url');
  await setDeviceLogin(deviceId, siteId, password);

  await db.$transaction([
    db.deviceCredential.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.deviceCredential.create({ data: { deviceId, type: 'mqtt_password', secretHash: await hash(password) } }),
    db.device.update({ where: { id: deviceId }, data: { siteId, status: 'provisioning', claimedAt: new Date(), claimedById } }),
    db.auditLog.create({
      data: { siteId, actorType: claimedById ? 'user' : 'system', actorId: claimedById, action: 'device.credentials_issued', targetType: 'device', targetId: deviceId },
    }),
  ]);

  const creds: Creds = { v: 1, siteId, username: deviceId, password, ts: Date.now() };
  mqttClient.publish(bootstrapTopic(deviceId, 'creds'), JSON.stringify(creds), { qos: 1 });
  lastIssued.set(deviceId, Date.now());
}

// ---------- claim

const proofFor = (code: string, nonce: string, deviceId: string) => createHmac('sha256', code).update(`${nonce}:${deviceId}`).digest();

function challenge(deviceId: string): Promise<{ nonce: string; res: ChallengeResponse | null }> {
  const nonce = randomBytes(16).toString('hex');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      challenges.delete(nonce);
      resolve({ nonce, res: null });
    }, CHALLENGE_TIMEOUT_MS);
    challenges.set(nonce, {
      deviceId,
      resolve: (res) => {
        clearTimeout(timer);
        challenges.delete(nonce);
        resolve({ nonce, res });
      },
    });
    const msg: Challenge = { v: 1, nonce, ts: Date.now() };
    mqttClient.publish(bootstrapTopic(deviceId, 'challenge'), JSON.stringify(msg), { qos: 1 });
  });
}

export async function claimDevice(siteId: string, deviceId: string, code: string, userId: string) {
  const wrong = wrongCodes.get(deviceId);
  if (wrong && Date.now() - wrong.first < WRONG_CODE_WINDOW_MS && wrong.count >= MAX_WRONG_CODES) throw new ClaimError('too_many_attempts', 429);

  const dev = await db.device.findUnique({ where: { id: deviceId } });
  if (!dev || dev.deletedAt) throw new ClaimError('device_not_found', 404);
  if (dev.siteId && dev.siteId !== siteId) throw new ClaimError('claimed_elsewhere', 409);
  // A board that got credentials after its last hello is using them; it is only claimable
  // again once it is back in bootstrap (factory reset → new hello).
  const seenAt = bootstrapSeen.get(deviceId) ?? 0;
  const inUse = dev.siteId === siteId && dev.status !== 'unclaimed' && (lastIssued.get(deviceId) ?? 0) >= seenAt;
  if (inUse) throw new ClaimError('already_claimed', 409);
  if (Date.now() - seenAt >= SEEN_WINDOW_MS) throw new ClaimError('device_not_ready', 409);

  const { nonce, res } = await challenge(deviceId);
  if (!res) throw new ClaimError('device_no_response', 504);
  const expected = proofFor(code, nonce, deviceId);
  const given = Buffer.from(res.proof, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    const w = wrong && Date.now() - wrong.first < WRONG_CODE_WINDOW_MS ? wrong : { count: 0, first: Date.now() };
    wrongCodes.set(deviceId, { ...w, count: w.count + 1 });
    throw new ClaimError('wrong_code', 403);
  }

  wrongCodes.delete(deviceId);
  const hub = await db.hub.findFirst({ where: { siteId } });
  await db.device.update({ where: { id: deviceId }, data: { siteId, hubId: hub?.id } });
  await db.auditLog.create({ data: { siteId, actorType: 'user', actorId: userId, action: 'device.claim', targetType: 'device', targetId: deviceId } });
  await issueDeviceCredentials(deviceId, siteId, userId);
}

// ---------- removal

/** Factory-resets the board if online, revokes its login, deletes its channels, frees it to be claimed again. */
export async function removeDevice(deviceId: string, userId: string) {
  const dev = await db.device.findUniqueOrThrow({ where: { id: deviceId }, include: { endpoints: { select: { id: true } } } });
  const siteId = dev.siteId!;
  if (dev.status === 'online') {
    const cmd: Cmd = { v: 1, cid: `c_${ulid()}`, op: 'factory_reset', confirm: 'YES', ts: Date.now() };
    await new Promise((r) => mqttClient.publish(devTopic(siteId, deviceId, 'cmd'), JSON.stringify(cmd), { qos: 1 }, r));
  }
  await deleteDeviceLogin(deviceId);
  for (const leaf of ['status', 'meta', 'state', 'config'] as const) {
    mqttClient.publish(devTopic(siteId, deviceId, leaf), '', { qos: 1, retain: true }); // clear retained copies
  }

  const ids = dev.endpoints.map((e) => e.id);
  await db.$transaction([
    db.sceneAction.deleteMany({ where: { endpointId: { in: ids } } }),
    db.endpointState.deleteMany({ where: { endpointId: { in: ids } } }),
    db.telemetry.deleteMany({ where: { endpointId: { in: ids } } }),
    db.command.deleteMany({ where: { endpointId: { in: ids } } }),
    db.endpoint.deleteMany({ where: { deviceId } }),
    db.deviceCredential.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.device.update({
      where: { id: deviceId },
      data: { siteId: null, hubId: null, status: 'unclaimed', claimedAt: null, claimedById: null, configRevDesired: 0, configRevApplied: 0 },
    }),
    db.auditLog.create({ data: { siteId, actorType: 'user', actorId: userId, action: 'device.remove', targetType: 'device', targetId: deviceId } }),
  ]);
  bootstrapSeen.delete(deviceId);
  broadcast(siteId, { type: 'topology.changed' }); // apps reload endpoints
  broadcast(siteId, { type: 'scenes.changed' });
}

// ---------- API

const ClaimBody = z.union([z.object({ code: z.string().min(10).max(80) }), z.object({ deviceId: z.string(), setupCode: z.string() })]);

export async function deviceRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/devices/claim', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!canManageDevices(await siteRole(req.user.sub, siteId))) return reply.code(403).send({ error: 'forbidden' });
    const body = parseBody(ClaimBody, req.body, reply);
    if (!body) return;
    const parsed = 'code' in body ? parseClaimCode(body.code) : parseClaimCode(`${body.deviceId} ${body.setupCode}`);
    if (!parsed) return reply.code(400).send({ error: 'invalid_code' });
    try {
      await claimDevice(siteId, parsed.deviceId, parsed.code, req.user.sub);
      return reply.code(201).send({ deviceId: parsed.deviceId });
    } catch (err) {
      if (err instanceof ClaimError) return reply.code(err.httpStatus).send({ error: err.code });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', auth, async (req, reply) => {
    const dev = await db.device.findUnique({ where: { id: req.params.id } });
    if (!dev?.siteId) return reply.code(404).send({ error: 'not_found' });
    if (!canManageDevices(await siteRole(req.user.sub, dev.siteId))) return reply.code(403).send({ error: 'forbidden' });
    await removeDevice(dev.id, req.user.sub);
    return reply.code(204).send();
  });
}
