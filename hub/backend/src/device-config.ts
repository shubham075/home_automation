// Desired board configuration (docs/02-mqtt-spec.md §2.7): retained, so a board that is
// offline now picks it up on its next connect and reports the applied rev in meta.cfgRev.
import { devTopic, type Config } from '@sw6/protocol';
import { db } from './db';
import { mqttClient } from './mqtt-client';

export async function pushDeviceConfig(deviceId: string) {
  const dev = await db.device.update({
    where: { id: deviceId },
    data: { configRevDesired: { increment: 1 } },
    include: { endpoints: { where: { kind: 'relay' }, orderBy: { channel: 'asc' } } },
  });
  if (!dev.siteId) return;

  const channels = Math.max(0, ...dev.endpoints.map((e) => e.channel));
  const byChannel = new Map(dev.endpoints.map((e) => [e.channel, e]));
  const at = <T>(pick: (e: (typeof dev.endpoints)[number]) => T, fallback: T) =>
    Array.from({ length: channels }, (_, i) => {
      const e = byChannel.get(i + 1);
      return e ? pick(e) : fallback;
    });

  const config: Config = {
    v: 1,
    rev: dev.configRevDesired,
    restore: at((e) => e.restorePolicy as Config['restore'][number], 'last'),
    inputMode: at((e) => e.inputMode as Config['inputMode'][number], 'toggle'),
    telemetrySec: 60,
  };
  mqttClient.publish(devTopic(dev.siteId, dev.id, 'config'), JSON.stringify(config), { qos: 1, retain: true });
}
