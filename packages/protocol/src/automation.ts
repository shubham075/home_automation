// Automation definitions, shared by the hub (validation, engine) and the app (builder form).
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM');
/** 0 = Sunday … 6 = Saturday. */
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7);

export const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('time'), at: hhmm, days }),
  z.object({ type: z.literal('sun'), event: z.enum(['sunrise', 'sunset']), offsetMin: z.number().int().min(-180).max(180), days }),
  z.object({ type: z.literal('endpoint'), endpointId: z.string(), to: z.boolean() }),
  z.object({ type: z.literal('device_offline'), deviceId: z.string(), forMin: z.number().int().min(1).max(1440) }),
]);

export const Action = z.discriminatedUnion('type', [
  /** offAfterMin: switch on now, off again after N minutes (auto-off timer). */
  z.object({ type: z.literal('set'), endpointId: z.string(), on: z.boolean(), offAfterMin: z.number().int().min(1).max(720).optional() }),
  z.object({ type: z.literal('scene'), sceneId: z.string() }),
  z.object({ type: z.literal('notify'), message: z.string().trim().min(1).max(140) }),
]);

/** Optional window; `from` later than `to` wraps past midnight (e.g. 22:00–06:00). */
export const Conditions = z.object({ between: z.object({ from: hhmm, to: hhmm }).optional() });

export const AutomationBody = z.object({
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().default(true),
  trigger: Trigger,
  conditions: Conditions.default({}),
  actions: z.array(Action).min(1).max(10),
});

export type Trigger = z.infer<typeof Trigger>;
export type Action = z.infer<typeof Action>;
export type Conditions = z.infer<typeof Conditions>;
export type AutomationBody = z.infer<typeof AutomationBody>;

export type AutomationView = AutomationBody & {
  id: string;
  lastRunAt: string | null;
  lastResult: string | null;
};

export type NotificationView = { id: string; type: string; title: string; body: string; createdAt: string; read: boolean };
