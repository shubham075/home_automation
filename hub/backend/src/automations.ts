// Automation engine (docs/04-workflows.md W5) and its API.
// Triggers: time, sunrise/sunset (checked every 15 s in the site's time zone), channel state
// changes and boards going offline (pushed in by the MQTT bridge). Missed runs are skipped, not replayed.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { AutomationBody, CAN, type Action, type AutomationView, type Conditions, type Trigger } from '@sw6/protocol';
import { guardSite, requireUser } from './auth';
import { CommandError, sendSet } from './commands';
import { db } from './db';
import { notifySite } from './notifications';
import { broadcast } from './realtime';
import { runActions } from './scenes';
import { sunTimes } from './sun';
import { parseBody } from './topology';

const TICK_MS = 15_000;
/** Stops an endpoint-triggered automation from re-firing on its own echo. */
const ENDPOINT_COOLDOWN_MS = 10_000;

type Row = Awaited<ReturnType<typeof loadAutomations>>[number];

const firedMinute = new Map<string, string>(); // automationId → "YYYY-MM-DD HH:MM" already run
const cooldownUntil = new Map<string, number>();
const offlineTimers = new Map<string, NodeJS.Timeout[]>(); // deviceId → pending offline triggers
const autoOffTimers = new Map<string, NodeJS.Timeout>(); // endpointId → pending auto-off
let log: FastifyBaseLogger;

// ---------- local time helpers

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localTime(tz: string, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, dow: DOW.indexOf(p.weekday) };
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function inWindow(between: NonNullable<Conditions['between']>, hhmm: string) {
  const [t, from, to] = [minutes(hhmm), minutes(between.from), minutes(between.to)];
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

// ---------- engine

async function loadAutomations(where: { siteId?: string; id?: string } = {}) {
  return db.automation.findMany({
    where: { enabled: true, ...where },
    include: { site: { select: { timezone: true, lat: true, lng: true } } },
  });
}

const trig = (a: Row) => a.trigger as unknown as Trigger;

async function tick() {
  for (const a of await loadAutomations()) {
    const t = trig(a);
    if (t.type !== 'time' && t.type !== 'sun') continue;
    const now = localTime(a.site.timezone);
    if (!t.days.includes(now.dow)) continue;

    let target = t.type === 'time' ? t.at : null;
    if (t.type === 'sun') {
      if (a.site.lat == null || a.site.lng == null) continue;
      const sun = sunTimes(new Date(), a.site.lat, a.site.lng);
      if (!sun) continue;
      target = localTime(a.site.timezone, new Date(sun[t.event].getTime() + t.offsetMin * 60_000)).hhmm;
    }
    const key = `${now.ymd} ${now.hhmm}`;
    if (now.hhmm !== target || firedMinute.get(a.id) === key) continue;
    firedMinute.set(a.id, key);
    void execute(a, t.type === 'time' ? `time ${t.at}` : `${t.event} ${t.offsetMin >= 0 ? '+' : ''}${t.offsetMin} min`);
  }
}

/** Called by the bridge for every channel whose state changed. */
export async function onEndpointChanged(siteId: string, endpointId: string, on: boolean) {
  for (const a of await loadAutomations({ siteId })) {
    const t = trig(a);
    if (t.type === 'endpoint' && t.endpointId === endpointId && t.to === on) void execute(a, `channel turned ${on ? 'on' : 'off'}`);
  }
}

/** Called by the bridge when a board goes offline or comes back. */
export async function onDeviceStatus(siteId: string, deviceId: string, online: boolean) {
  offlineTimers.get(deviceId)?.forEach(clearTimeout);
  offlineTimers.delete(deviceId);
  if (online) return;
  const timers: NodeJS.Timeout[] = [];
  for (const a of await loadAutomations({ siteId })) {
    const t = trig(a);
    if (t.type !== 'device_offline' || t.deviceId !== deviceId) continue;
    timers.push(
      setTimeout(async () => {
        const dev = await db.device.findUnique({ where: { id: deviceId } });
        if (dev?.status === 'offline') void execute(a, `board offline for ${t.forMin} min`);
      }, t.forMin * 60_000),
    );
  }
  if (timers.length) offlineTimers.set(deviceId, timers);
}

async function runAction(a: Row, action: Action): Promise<boolean> {
  switch (action.type) {
    case 'set': {
      try {
        const { result } = await sendSet({ endpointId: action.endpointId, on: action.on, source: 'automation' });
        const ok = (await result) === 'acked';
        if (ok && action.on && action.offAfterMin) {
          clearTimeout(autoOffTimers.get(action.endpointId));
          autoOffTimers.set(
            action.endpointId,
            setTimeout(() => {
              autoOffTimers.delete(action.endpointId);
              sendSet({ endpointId: action.endpointId, on: false, source: 'automation' }).catch(() => undefined);
            }, action.offAfterMin * 60_000),
          );
        }
        return ok;
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
        return false;
      }
    }
    case 'scene': {
      const scene = await db.scene.findFirst({ where: { id: action.sceneId, siteId: a.siteId }, include: { actions: true } });
      if (!scene) return false;
      const run = await runActions(
        a.siteId,
        scene.actions.map((x) => ({ endpointId: x.endpointId, on: (x.target as { on: boolean }).on })),
        null,
        scene.name,
        'automation',
      );
      return run.results.every((r) => r.status === 'acked');
    }
    case 'notify':
      await notifySite(a.siteId, 'automation', a.name, action.message);
      return true;
  }
}

/** `force` (Run now from the app) skips the time-window condition and cooldown. */
async function execute(a: Row, reason: string, force = false) {
  const conditions = a.conditions as unknown as Conditions;
  if (!force && conditions.between && !inWindow(conditions.between, localTime(a.site.timezone).hhmm)) {
    await db.automationRun.create({ data: { automationId: a.id, triggerSnapshot: reason, result: 'skipped_condition' } });
    return;
  }
  const cooldown = trig(a).type === 'endpoint' ? ENDPOINT_COOLDOWN_MS : a.cooldownSec * 1000;
  if (!force && Date.now() < (cooldownUntil.get(a.id) ?? 0)) return;
  if (cooldown) cooldownUntil.set(a.id, Date.now() + cooldown);

  const outcomes: boolean[] = [];
  for (const action of a.actions as unknown as Action[]) {
    outcomes.push(await runAction(a, action).catch(() => false));
  }
  const ok = outcomes.filter(Boolean).length;
  const result = ok === outcomes.length ? 'success' : ok === 0 ? 'failed' : 'partial';
  await db.$transaction([
    db.automationRun.create({ data: { automationId: a.id, triggerSnapshot: reason, result, detail: `${ok}/${outcomes.length} actions` } }),
    db.automation.update({ where: { id: a.id }, data: { lastRunAt: new Date() } }),
  ]);
  log?.info({ automation: a.name, reason, result }, 'automation ran');
  broadcast(a.siteId, { type: 'automations.changed' });
  return result;
}

export function startAutomationEngine(logger: FastifyBaseLogger) {
  log = logger;
  setInterval(() => tick().catch((err) => log.error({ err: String(err) }, 'automation tick failed')), TICK_MS);
}

// ---------- API

/** Every channel, scene or board an automation references must belong to its site. */
async function validRefs(siteId: string, body: AutomationBody) {
  const endpoints = new Set<string>();
  const scenes = new Set<string>();
  const devices = new Set<string>();
  if (body.trigger.type === 'endpoint') endpoints.add(body.trigger.endpointId);
  if (body.trigger.type === 'device_offline') devices.add(body.trigger.deviceId);
  for (const x of body.actions) {
    if (x.type === 'set') endpoints.add(x.endpointId);
    if (x.type === 'scene') scenes.add(x.sceneId);
  }
  const [e, s, d] = await Promise.all([
    db.endpoint.count({ where: { id: { in: [...endpoints] }, kind: 'relay', device: { siteId, deletedAt: null } } }),
    db.scene.count({ where: { id: { in: [...scenes] }, siteId } }),
    db.device.count({ where: { id: { in: [...devices] }, siteId, deletedAt: null } }),
  ]);
  return e === endpoints.size && s === scenes.size && d === devices.size;
}

async function views(siteId: string): Promise<AutomationView[]> {
  const rows = await db.automation.findMany({
    where: { siteId },
    orderBy: { createdAt: 'asc' },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    trigger: a.trigger as unknown as Trigger,
    conditions: a.conditions as unknown as Conditions,
    actions: a.actions as unknown as Action[],
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    lastResult: a.runs[0]?.result ?? null,
  }));
}

export async function automationRoutes(app: FastifyInstance) {
  const auth = { onRequest: requireUser };
  const changed = (siteId: string) => broadcast(siteId, { type: 'automations.changed' });

  app.get<{ Params: { siteId: string } }>('/api/sites/:siteId/automations', auth, async (req, reply) => {
    if (!(await guardSite(req, reply, req.params.siteId, CAN.control))) return;
    return { automations: await views(req.params.siteId) };
  });

  app.post<{ Params: { siteId: string } }>('/api/sites/:siteId/automations', auth, async (req, reply) => {
    const { siteId } = req.params;
    if (!(await guardSite(req, reply, siteId, CAN.editScenes))) return;
    const body = parseBody(AutomationBody, req.body, reply);
    if (!body) return;
    if (!(await validRefs(siteId, body))) return reply.code(400).send({ error: 'invalid_references' });
    const a = await db.automation.create({ data: { siteId, createdById: req.user.sub, ...body } });
    changed(siteId);
    return reply.code(201).send({ id: a.id });
  });

  app.put<{ Params: { id: string } }>('/api/automations/:id', auth, async (req, reply) => {
    const a = await db.automation.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, a?.siteId, CAN.editScenes))) return;
    const body = parseBody(AutomationBody, req.body, reply);
    if (!body) return;
    if (!(await validRefs(a!.siteId, body))) return reply.code(400).send({ error: 'invalid_references' });
    await db.automation.update({ where: { id: a!.id }, data: body });
    cooldownUntil.delete(a!.id);
    changed(a!.siteId);
    return { id: a!.id };
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: unknown } }>('/api/automations/:id', auth, async (req, reply) => {
    const a = await db.automation.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, a?.siteId, CAN.editScenes))) return;
    if (typeof req.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_body' });
    await db.automation.update({ where: { id: a!.id }, data: { enabled: req.body.enabled } });
    changed(a!.siteId);
    return { id: a!.id, enabled: req.body.enabled };
  });

  app.delete<{ Params: { id: string } }>('/api/automations/:id', auth, async (req, reply) => {
    const a = await db.automation.findUnique({ where: { id: req.params.id } });
    if (!(await guardSite(req, reply, a?.siteId, CAN.editScenes))) return;
    await db.$transaction([
      db.command.updateMany({ where: { automationRun: { automationId: a!.id } }, data: { automationRunId: null } }),
      db.automationRun.deleteMany({ where: { automationId: a!.id } }),
      db.automation.delete({ where: { id: a!.id } }),
    ]);
    changed(a!.siteId);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/automations/:id/run', auth, async (req, reply) => {
    const [a] = await db.automation.findMany({ where: { id: req.params.id }, include: { site: { select: { timezone: true, lat: true, lng: true } } } });
    if (!(await guardSite(req, reply, a?.siteId, CAN.editScenes))) return;
    return { result: await execute(a, 'run now from app', true) };
  });
}
