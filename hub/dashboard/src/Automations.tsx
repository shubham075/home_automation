// Automations: list with on/off switch and Run now, plus a guided "When / Only between / Then" editor.
import { useState, type FormEvent } from 'react';
import type { Action, AutomationBody, AutomationView, EndpointView, SceneView, Trigger } from '@sw6/protocol';
import { api, ApiError } from './api';
import { endpointLabel, useAutomations, useEndpoints, useScenes } from './data';
import { Icon } from './icons';

const field =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900';
const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const RESULT: Record<string, string> = {
  success: 'done',
  partial: 'partly done',
  failed: 'failed',
  skipped_condition: 'skipped (outside time window)',
};

function daysText(days: number[]) {
  const s = [...days].sort().join();
  if (s === '0,1,2,3,4,5,6') return 'every day';
  if (s === '1,2,3,4,5') return 'Mon–Fri';
  if (s === '0,6') return 'weekends';
  return days.map((d) => DAY_NAME[d]).join(', ');
}

function describe(a: AutomationBody, eps: EndpointView[], scenes: SceneView[]) {
  const ep = (id: string) => {
    const e = eps.find((x) => x.id === id);
    return e ? endpointLabel(e) + (e.room ? ` (${e.room.name})` : '') : 'a removed channel';
  };
  const t = a.trigger;
  const when =
    t.type === 'time'
      ? `At ${t.at}, ${daysText(t.days)}`
      : t.type === 'sun'
        ? `${t.offsetMin === 0 ? 'At' : `${Math.abs(t.offsetMin)} min ${t.offsetMin < 0 ? 'before' : 'after'}`} ${t.event}, ${daysText(t.days)}`
        : t.type === 'endpoint'
          ? `When ${ep(t.endpointId)} turns ${t.to ? 'on' : 'off'}`
          : `When board ${t.deviceId.slice(-4)} is offline for ${t.forMin} min`;
  const then = a.actions
    .map((x) =>
      x.type === 'set'
        ? `${ep(x.endpointId)} ${x.on ? 'on' : 'off'}${x.on && x.offAfterMin ? `, off after ${x.offAfterMin} min` : ''}`
        : x.type === 'scene'
          ? `run ${scenes.find((s) => s.id === x.sceneId)?.name ?? 'a removed scene'}`
          : `notify “${x.message}”`,
    )
    .join('; ');
  const only = a.conditions.between ? ` (only ${a.conditions.between.from}–${a.conditions.between.to})` : '';
  return `${when}${only} → ${then}`;
}

export function Automations({ siteId, canEdit, notify }: { siteId: string; canEdit: boolean; notify: (msg: string) => void }) {
  const list = useAutomations(siteId);
  const eps = (useEndpoints(siteId).data ?? []).filter((e) => !e.hidden);
  const scenes = (useScenes(siteId).data ?? []).filter((s) => !s.builtin);
  const [editing, setEditing] = useState<AutomationView | 'new' | null>(null);

  async function toggle(a: AutomationView) {
    await api(`/api/automations/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } }).catch(() => notify('Could not change it. Try again.'));
  }
  async function runNow(a: AutomationView) {
    const r = await api<{ result: string }>(`/api/automations/${a.id}/run`, { method: 'POST' }).catch(() => null);
    notify(r ? `${a.name}: ${RESULT[r.result] ?? r.result}.` : 'Could not run it. Check the hub connection.');
  }

  if (!list.data) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Routines the hub runs on its own, even when no phone is open.</p>
        {canEdit && (
          <button onClick={() => setEditing('new')} className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">
            <Icon name="plus" className="size-4" /> New
          </button>
        )}
      </div>
      {list.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No automations yet. Try "Porch light on 15 min before sunset" or "Exhaust fan off 10 min after it turns on".
        </div>
      )}
      {list.data.map((a) => (
        <div key={a.id} className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${a.enabled ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold">{a.name}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">{describe(a, eps, scenes)}</p>
            </div>
            <button
              role="switch"
              aria-checked={a.enabled}
              aria-label={`${a.name} enabled`}
              disabled={!canEdit}
              onClick={() => toggle(a)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${a.enabled ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-700'}`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${a.enabled ? 'left-5.5' : 'left-0.5'}`} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{a.lastRunAt ? `Last ran ${new Date(a.lastRunAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · ${RESULT[a.lastResult ?? ''] ?? a.lastResult}` : 'Has not run yet'}</span>
            {canEdit && (
              <span className="flex gap-3">
                <button onClick={() => runNow(a)} className="font-medium hover:text-slate-900 dark:hover:text-white">Run now</button>
                <button onClick={() => setEditing(a)} className="font-medium hover:text-slate-900 dark:hover:text-white">Edit</button>
              </span>
            )}
          </div>
        </div>
      ))}
      {editing && (
        <Editor siteId={siteId} initial={editing === 'new' ? null : editing} eps={eps} scenes={scenes} onClose={() => setEditing(null)} notify={notify} />
      )}
    </div>
  );
}

function Editor({
  siteId,
  initial,
  eps,
  scenes,
  onClose,
  notify,
}: {
  siteId: string;
  initial: AutomationView | null;
  eps: EndpointView[];
  scenes: SceneView[];
  onClose: () => void;
  notify: (msg: string) => void;
}) {
  const firstEp = eps[0]?.id ?? '';
  const boards = [...new Set(eps.map((e) => e.deviceId))];
  const [name, setName] = useState(initial?.name ?? '');
  const [trigger, setTrigger] = useState<Trigger>(initial?.trigger ?? { type: 'time', at: '18:30', days: ALL_DAYS });
  const [between, setBetween] = useState(initial?.conditions.between ?? null);
  const [actions, setActions] = useState<Action[]>(initial?.actions ?? [{ type: 'set', endpointId: firstEp, on: true }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setType = (type: Trigger['type']) =>
    setTrigger(
      type === 'time'
        ? { type, at: '18:30', days: ALL_DAYS }
        : type === 'sun'
          ? { type, event: 'sunset', offsetMin: -15, days: ALL_DAYS }
          : type === 'endpoint'
            ? { type, endpointId: firstEp, to: true }
            : { type, deviceId: boards[0] ?? '', forMin: 5 },
    );
  const updateAction = (i: number, a: Action) => setActions((xs) => xs.map((x, j) => (j === i ? a : x)));
  const days = 'days' in trigger ? trigger.days : null;
  const toggleDay = (d: number) => {
    if (!days) return;
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    if (next.length) setTrigger({ ...trigger, days: next } as Trigger);
  };

  const epSelect = (value: string, onChange: (id: string) => void, id: string) => (
    <select id={id} aria-label="Channel" className={`${field} min-w-0 flex-1`} value={value} onChange={(e) => onChange(e.target.value)}>
      {eps.map((e) => (
        <option key={e.id} value={e.id}>{endpointLabel(e)}{e.room ? ` · ${e.room.name}` : ''}</option>
      ))}
    </select>
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the automation a name.');
    setBusy(true);
    const body: AutomationBody = { name: name.trim(), enabled: initial?.enabled ?? true, trigger, conditions: between ? { between } : {}, actions };
    try {
      if (initial) await api(`/api/automations/${initial.id}`, { method: 'PUT', body });
      else await api(`/api/sites/${siteId}/automations`, { method: 'POST', body });
      notify(`Saved ${body.name}.`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_body' ? 'Some fields are incomplete. Check the times and messages.' : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || !window.confirm(`Delete "${initial.name}"?`)) return;
    await api(`/api/automations/${initial.id}`, { method: 'DELETE' }).catch(() => undefined);
    notify(`Deleted ${initial.name}.`);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? 'Edit automation' : 'New automation'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500"><Icon name="close" /></button>
        </div>
        <input id="auto-name" placeholder="Name, e.g. Porch light at sunset" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={`${field} py-2 text-base`} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">When</legend>
          <select id="trigger-type" className={field} value={trigger.type} onChange={(e) => setType(e.target.value as Trigger['type'])}>
            <option value="time">At a time</option>
            <option value="sun">At sunrise / sunset</option>
            <option value="endpoint">A channel turns on or off</option>
            <option value="device_offline">A board goes offline</option>
          </select>
          {trigger.type === 'time' && (
            <input id="trigger-at" type="time" className={field} value={trigger.at} onChange={(e) => setTrigger({ ...trigger, at: e.target.value })} />
          )}
          {trigger.type === 'sun' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input id="trigger-offset" type="number" min={0} max={180} className={`${field} w-20`} value={Math.abs(trigger.offsetMin)} onChange={(e) => setTrigger({ ...trigger, offsetMin: Math.sign(trigger.offsetMin || -1) * Math.min(180, Number(e.target.value)) })} />
              min
              <select id="trigger-dir" className={field} value={trigger.offsetMin < 0 ? 'before' : 'after'} onChange={(e) => setTrigger({ ...trigger, offsetMin: Math.abs(trigger.offsetMin) * (e.target.value === 'before' ? -1 : 1) })}>
                <option value="before">before</option>
                <option value="after">after</option>
              </select>
              <select id="trigger-event" className={field} value={trigger.event} onChange={(e) => setTrigger({ ...trigger, event: e.target.value as 'sunrise' | 'sunset' })}>
                <option value="sunset">sunset</option>
                <option value="sunrise">sunrise</option>
              </select>
            </div>
          )}
          {days && (
            <div className="flex gap-1" role="group" aria-label="Days">
              {DAY.map((d, i) => (
                <button key={i} type="button" aria-pressed={days.includes(i)} aria-label={DAY_NAME[i]} onClick={() => toggleDay(i)} className={`size-8 rounded-full text-xs font-semibold ${days.includes(i) ? 'bg-accent text-white' : 'border border-slate-300 text-slate-500 dark:border-slate-700'}`}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {trigger.type === 'endpoint' && (
            <div className="flex gap-2">
              {epSelect(trigger.endpointId, (endpointId) => setTrigger({ ...trigger, endpointId }), 'trigger-ep')}
              <select id="trigger-to" className={field} value={trigger.to ? 'on' : 'off'} onChange={(e) => setTrigger({ ...trigger, to: e.target.value === 'on' })}>
                <option value="on">turns on</option>
                <option value="off">turns off</option>
              </select>
            </div>
          )}
          {trigger.type === 'device_offline' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select id="trigger-board" className={field} value={trigger.deviceId} onChange={(e) => setTrigger({ ...trigger, deviceId: e.target.value })}>
                {boards.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              for
              <input id="trigger-for" type="number" min={1} max={1440} className={`${field} w-20`} value={trigger.forMin} onChange={(e) => setTrigger({ ...trigger, forMin: Math.max(1, Number(e.target.value)) })} />
              min
            </div>
          )}
          <label className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <input id="only-between" type="checkbox" checked={!!between} onChange={(e) => setBetween(e.target.checked ? { from: '18:00', to: '06:00' } : null)} />
            Only between
            {between && (
              <>
                <input id="between-from" type="time" className={field} value={between.from} onChange={(e) => setBetween({ ...between, from: e.target.value })} />
                and
                <input id="between-to" type="time" className={field} value={between.to} onChange={(e) => setBetween({ ...between, to: e.target.value })} />
              </>
            )}
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">Then</legend>
          {actions.map((a, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              <div className="flex gap-2">
                <select
                  id={`action-type-${i}`}
                  aria-label="Action"
                  className={field}
                  value={a.type}
                  onChange={(e) => {
                    const type = e.target.value as Action['type'];
                    updateAction(i, type === 'set' ? { type, endpointId: firstEp, on: true } : type === 'scene' ? { type, sceneId: scenes[0]?.id ?? '' } : { type, message: '' });
                  }}
                >
                  <option value="set">Switch a channel</option>
                  <option value="scene" disabled={scenes.length === 0}>Run a scene</option>
                  <option value="notify">Send a notification</option>
                </select>
                {actions.length > 1 && (
                  <button type="button" aria-label="Remove action" onClick={() => setActions((xs) => xs.filter((_, j) => j !== i))} className="ml-auto rounded-md p-1.5 text-slate-500"><Icon name="trash" className="size-4" /></button>
                )}
              </div>
              {a.type === 'set' && (
                <>
                  <div className="flex gap-2">
                    {epSelect(a.endpointId, (endpointId) => updateAction(i, { ...a, endpointId }), `action-ep-${i}`)}
                    <select id={`action-on-${i}`} className={field} value={a.on ? 'on' : 'off'} onChange={(e) => updateAction(i, { ...a, on: e.target.value === 'on', offAfterMin: undefined })}>
                      <option value="on">on</option>
                      <option value="off">off</option>
                    </select>
                  </div>
                  {a.on && (
                    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <input id={`action-auto-off-${i}`} type="checkbox" checked={!!a.offAfterMin} onChange={(e) => updateAction(i, { ...a, offAfterMin: e.target.checked ? 10 : undefined })} />
                      Turn off again after
                      <input id={`action-minutes-${i}`} type="number" min={1} max={720} disabled={!a.offAfterMin} className={`${field} w-20`} value={a.offAfterMin ?? 10} onChange={(e) => updateAction(i, { ...a, offAfterMin: Math.max(1, Number(e.target.value)) })} />
                      min
                    </label>
                  )}
                </>
              )}
              {a.type === 'scene' && (
                <select id={`action-scene-${i}`} className={field} value={a.sceneId} onChange={(e) => updateAction(i, { ...a, sceneId: e.target.value })}>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              {a.type === 'notify' && (
                <input id={`action-msg-${i}`} placeholder="Message, e.g. Main board is offline" maxLength={140} className={field} value={a.message} onChange={(e) => updateAction(i, { ...a, message: e.target.value })} />
              )}
            </div>
          ))}
          {actions.length < 10 && (
            <button type="button" onClick={() => setActions((xs) => [...xs, { type: 'set', endpointId: firstEp, on: false }])} className="flex items-center gap-1 self-start text-sm font-medium text-accent">
              <Icon name="plus" className="size-4" /> Add another action
            </button>
          )}
        </fieldset>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {initial ? <button type="button" onClick={remove} className="text-sm text-red-600 dark:text-red-400">Delete</button> : <span />}
          <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save automation'}</button>
        </div>
      </form>
    </div>
  );
}
