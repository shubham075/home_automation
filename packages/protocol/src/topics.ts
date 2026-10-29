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

/**
 * Unprovisioned boards (ACL limits each to its own %c topics):
 * hello, response: device → hub · creds, challenge: hub → that device only.
 */
export type BootstrapLeaf = 'hello' | 'creds' | 'challenge' | 'response';
const BOOTSTRAP_LEAVES: BootstrapLeaf[] = ['hello', 'creds', 'challenge', 'response'];
export const bootstrapTopic = (deviceId: string, leaf: BootstrapLeaf) => `${NS}/bootstrap/${deviceId}/${leaf}`;
export const BOOTSTRAP_HELLO_WILDCARD = `${NS}/bootstrap/+/hello`;
export const BOOTSTRAP_RESPONSE_WILDCARD = `${NS}/bootstrap/+/response`;

export function parseBootstrapTopic(topic: string): { deviceId: string; leaf: BootstrapLeaf } | null {
  const p = topic.split('/');
  if (p.length !== 5 || `${p[0]}/${p[1]}` !== NS || p[2] !== 'bootstrap') return null;
  const leaf = p[4] as BootstrapLeaf;
  return BOOTSTRAP_LEAVES.includes(leaf) ? { deviceId: p[3], leaf } : null;
}

export function parseDevTopic(topic: string): { siteId: string; deviceId: string; leaf: Leaf } | null {
  const p = topic.split('/');
  if (p.length < 6 || `${p[0]}/${p[1]}` !== NS || p[3] !== 'dev') return null;
  return { siteId: p[2], deviceId: p[4], leaf: p.slice(5).join('/') as Leaf };
}
