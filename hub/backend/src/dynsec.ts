// Mosquitto Dynamic Security over its $CONTROL API: broker logins and ACL roles, changed live.
// Responses carry no correlation id, so requests run one at a time.
import { mqttClient } from './mqtt-client';

const REQUEST = '$CONTROL/dynamic-security/v1';
export const DYNSEC_RESPONSE = `${REQUEST}/response`;
const TIMEOUT_MS = 5000;

type Command = { command: string } & Record<string, unknown>;
type Response = { command: string; error?: string };
type Acl = { acltype: 'publishClientSend' | 'subscribePattern'; topic: string; allow: boolean; priority?: number };

let chain: Promise<unknown> = Promise.resolve();
let waiting: ((r: Response[]) => void) | null = null;

/** Call once from the MQTT message handler. Returns true if the message was a dynsec response. */
export function onDynsecMessage(topic: string, buf: Buffer) {
  if (topic !== DYNSEC_RESPONSE) return false;
  const w = waiting;
  waiting = null;
  w?.(JSON.parse(buf.toString()).responses ?? []);
  return true;
}

function send(commands: Command[]): Promise<Response[]> {
  const run = () =>
    new Promise<Response[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting = null;
        reject(new Error('dynamic security request timed out'));
      }, TIMEOUT_MS);
      waiting = (r) => {
        clearTimeout(timer);
        resolve(r);
      };
      mqttClient.publish(REQUEST, JSON.stringify({ commands }), { qos: 1 });
    });
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** Runs commands; errors matching `tolerate` (e.g. "already exists") are not failures. */
async function run(commands: Command[], tolerate: RegExp = /$^/) {
  const responses = await send(commands);
  const failed = responses.filter((r) => r.error && !tolerate.test(r.error));
  if (failed.length) throw new Error(`dynsec: ${failed.map((r) => `${r.command}: ${r.error}`).join('; ')}`);
}

const acl = (acltype: Acl['acltype'], topic: string): Acl => ({ acltype, topic, allow: true });

/** Roles and logins the hub itself needs. Idempotent; runs on every backend start. */
export async function ensureBrokerSetup(adminUser: string, bootstrapPassword: string) {
  const roles: { rolename: string; acls: Acl[] }[] = [
    { rolename: 'hub-backend', acls: [acl('publishClientSend', 'ha/v1/#'), acl('subscribePattern', 'ha/v1/#')] },
    {
      // %c = the connecting client id, which must equal the device id: a board can only
      // announce itself and only read its own credentials.
      rolename: 'bootstrap',
      acls: [
        acl('publishClientSend', 'ha/v1/bootstrap/%c/hello'),
        acl('publishClientSend', 'ha/v1/bootstrap/%c/response'),
        acl('subscribePattern', 'ha/v1/bootstrap/%c/creds'),
        acl('subscribePattern', 'ha/v1/bootstrap/%c/challenge'),
      ],
    },
  ];
  await run(
    roles.flatMap((r) => [
      { command: 'createRole', rolename: r.rolename },
      ...r.acls.map((a) => ({ command: 'addRoleACL', rolename: r.rolename, ...a })),
    ]),
    /already exists/i,
  );
  await run([{ command: 'addClientRole', username: adminUser, rolename: 'hub-backend' }], /already|exists/i);
  await run([{ command: 'createClient', username: 'bootstrap', password: bootstrapPassword, roles: [{ rolename: 'bootstrap' }] }], /already exists/i);
  await run([{ command: 'setClientPassword', username: 'bootstrap', password: bootstrapPassword }]);
}

/** (Re)creates a device's own login, locked to its client id and its own topic subtree. */
export async function setDeviceLogin(deviceId: string, siteId: string, password: string) {
  const rolename = `device:${deviceId}`;
  const own = `ha/v1/${siteId}/dev/${deviceId}/#`;
  await run(
    [
      { command: 'deleteClient', username: deviceId },
      { command: 'deleteRole', rolename },
    ],
    /not found/i,
  );
  await run([
    {
      command: 'createRole',
      rolename,
      acls: [acl('publishClientSend', own), acl('subscribePattern', own), acl('subscribePattern', `ha/v1/${siteId}/hub/#`)],
    },
    { command: 'createClient', username: deviceId, password, clientid: deviceId, roles: [{ rolename }] },
  ]);
}

export async function deleteDeviceLogin(deviceId: string) {
  await run(
    [
      { command: 'deleteClient', username: deviceId },
      { command: 'deleteRole', rolename: `device:${deviceId}` },
    ],
    /not found/i,
  );
}
