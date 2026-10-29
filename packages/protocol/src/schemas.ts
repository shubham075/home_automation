// Payload schemas for the MQTT spec (v1). Firmware mirrors these in protocol.h.
import { z } from 'zod';

const ts = z.number().int().nonnegative();
const v1 = z.literal(1);
const channel = z.number().int().min(1).max(16);

export const Status = z.enum(['online', 'offline']);

export const ChannelMeta = z.object({
  ch: channel,
  kind: z.enum(['relay', 'dimmer', 'fan_speed', 'input', 'sensor']),
  input: z.boolean().default(false),
  maxA: z.number().optional(),
});

export const Meta = z.object({
  v: v1,
  model: z.string(),
  hw: z.string(),
  fw: z.string(),
  mac: z.string(),
  channels: z.array(ChannelMeta).min(1),
  caps: z.array(z.string()).default([]),
  cfgRev: z.number().int().nonnegative().default(0),
  ts,
});

export const ChangeSource = z.enum(['physical', 'cmd', 'restore', 'local_rule']);

export const State = z.object({
  v: v1,
  ch: z.array(z.boolean()).min(1),
  src: ChangeSource,
  chg: z.array(channel).default([]),
  seq: z.number().int().nonnegative(),
  ts,
});

const cmdBase = z.object({ v: v1, cid: z.string().min(1), ts });

export const Cmd = z.discriminatedUnion('op', [
  cmdBase.extend({ op: z.literal('set'), ch: channel, on: z.boolean() }),
  cmdBase.extend({ op: z.literal('toggle'), ch: channel }),
  cmdBase.extend({ op: z.literal('set_many'), ch: z.array(z.boolean().nullable()) }),
  cmdBase.extend({ op: z.literal('all_off') }),
  cmdBase.extend({ op: z.literal('identify'), sec: z.number().int().min(1).max(60) }),
  cmdBase.extend({ op: z.literal('reboot') }),
]);

export const AckError = z.enum(['invalid_channel', 'invalid_op', 'busy', 'overcurrent', 'unauthorized']);

export const CmdAck = z.object({
  v: v1,
  cid: z.string(),
  ok: z.boolean(),
  state: z.array(z.boolean()).optional(),
  err: AckError.optional(),
  ts,
});

export const Event = z.discriminatedUnion('type', [
  z.object({ v: v1, type: z.literal('input'), ch: channel, edge: z.enum(['on', 'off']), ts }),
  z.object({
    v: v1,
    type: z.literal('boot'),
    reason: z.enum(['power_on', 'watchdog', 'brownout', 'ota', 'ota_rollback', 'sw_reset']),
    ts,
  }),
  z.object({ v: v1, type: z.literal('error'), code: z.string(), msg: z.string().optional(), ts }),
  z.object({ v: v1, type: z.literal('factory_reset'), ts }),
]);

export const Telemetry = z.object({
  v: v1,
  rssi: z.number().int(),
  heap: z.number().int().nonnegative(),
  up: z.number().int().nonnegative(),
  tC: z.number().optional(),
  ip: z.string().optional(),
  ts,
});

export const Hello = z.object({
  v: v1,
  model: z.string(),
  mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
  fw: z.string(),
  ts,
});

export const Creds = z.object({
  v: v1,
  siteId: z.string(),
  username: z.string(),
  password: z.string(),
  ts,
});

/** Device id is derived from model + MAC, so a board cannot claim another board's identity. */
export const deviceIdFor = (model: string, mac: string) => `${model.toLowerCase()}-${mac.replaceAll(':', '')}`;

export type Status = z.infer<typeof Status>;
export type Hello = z.infer<typeof Hello>;
export type Creds = z.infer<typeof Creds>;
export type Meta = z.infer<typeof Meta>;
export type State = z.infer<typeof State>;
export type Cmd = z.infer<typeof Cmd>;
export type CmdAck = z.infer<typeof CmdAck>;
export type Event = z.infer<typeof Event>;
export type Telemetry = z.infer<typeof Telemetry>;
