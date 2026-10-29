// Device bootstrap (docs/04-workflows.md W2): an unprovisioned board connects as the shared
// "bootstrap" login, says hello, and receives its own broker login on its private creds topic.
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { FastifyBaseLogger } from 'fastify';
import { bootstrapTopic, deviceIdFor, type Creds, type Hello } from '@sw6/protocol';
import { config } from './config';
import { db } from './db';
import { setDeviceLogin } from './dynsec';
import { mqttClient } from './mqtt-client';

const HELLO_COOLDOWN_MS = 30_000;
const lastIssued = new Map<string, number>();

export async function onHello(deviceId: string, hello: Hello, log: FastifyBaseLogger) {
  if (deviceIdFor(hello.model, hello.mac) !== deviceId) throw new Error('device id does not match model and MAC');
  const model = await db.deviceModel.findUnique({ where: { sku: hello.model } });
  if (!model) throw new Error(`unknown device model ${hello.model}`);

  // A board retrying hello in a loop must not rotate its password every few seconds.
  if (Date.now() - (lastIssued.get(deviceId) ?? 0) < HELLO_COOLDOWN_MS) return;

  let dev = await db.device.findUnique({ where: { id: deviceId } });
  if (dev?.deletedAt) throw new Error('device was decommissioned');

  // Production: credentials are issued only by the BLE claim step (proof of possession).
  // Dev: boards are approved straight into DEV_AUTO_APPROVE_SITE.
  const siteId = dev?.siteId ?? (config.DEV_AUTO_APPROVE_SITE || null);
  if (!dev) {
    const hub = siteId ? await db.hub.findFirst({ where: { siteId } }) : null;
    dev = await db.device.create({
      data: {
        id: deviceId,
        modelId: model.id,
        name: `${hello.model} ${hello.mac.slice(-5).replace(':', '')}`,
        mac: hello.mac,
        fwVersion: hello.fw,
        status: 'unclaimed',
        siteId: config.DEV_AUTO_APPROVE_SITE ? siteId : null,
        hubId: hub?.id,
      },
    });
  }
  if (!config.DEV_AUTO_APPROVE_SITE || !siteId) {
    log.info({ deviceId }, 'device waiting to be claimed');
    return;
  }

  await issueDeviceCredentials(deviceId, siteId);
  log.info({ deviceId, siteId }, 'device credentials issued');
}

export async function issueDeviceCredentials(deviceId: string, siteId: string) {
  const password = randomBytes(24).toString('base64url');
  await setDeviceLogin(deviceId, siteId, password);

  await db.$transaction([
    db.deviceCredential.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.deviceCredential.create({ data: { deviceId, type: 'mqtt_password', secretHash: await hash(password) } }),
    db.device.update({ where: { id: deviceId }, data: { siteId, status: 'provisioning', claimedAt: new Date() } }),
    db.auditLog.create({
      data: { siteId, actorType: 'system', action: 'device.credentials_issued', targetType: 'device', targetId: deviceId },
    }),
  ]);

  const creds: Creds = { v: 1, siteId, username: deviceId, password, ts: Date.now() };
  mqttClient.publish(bootstrapTopic(deviceId, 'creds'), JSON.stringify(creds), { qos: 1 });
  lastIssued.set(deviceId, Date.now());
}
