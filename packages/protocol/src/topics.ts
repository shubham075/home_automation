// Topic helpers for the MQTT spec in docs/02-mqtt-spec.md.
export const NS = 'ha/v1';

export type Leaf =
  | 'status'
  | 'meta'
  | 'state'
  | 'cmd'
  | 'cmd/ack'
  | 'event'
  | 'telemetry'
  | 'config'
  | 'ota'
  | 'ota/progress';

export const devTopic = (siteId: string, deviceId: string, leaf: Leaf) =>
  `${NS}/${siteId}/dev/${deviceId}/${leaf}`;

/** Everything any device publishes, for the hub backend. */
export const DEVICE_WILDCARD = `${NS}/+/dev/+/#`;

export function parseDevTopic(topic: string): { siteId: string; deviceId: string; leaf: Leaf } | null {
  const p = topic.split('/');
  if (p.length < 6 || `${p[0]}/${p[1]}` !== NS || p[3] !== 'dev') return null;
  return { siteId: p[2], deviceId: p[4], leaf: p.slice(5).join('/') as Leaf };
}
