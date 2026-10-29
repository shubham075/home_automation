// Create or edit a scene: pick ON / OFF per channel, or leave it out.
import { useState, type FormEvent } from 'react';
import type { EndpointView, SceneView } from '@sw6/protocol';
import { api } from './api';
import { endpointLabel, type FloorGroup } from './data';
import { Icon } from './icons';

type Choice = 'skip' | 'on' | 'off';

export function SceneEditor({
  siteId,
  scene,
  groups,
  onClose,
  notify,
}: {
  siteId: string;
  scene: SceneView | null;
  groups: FloorGroup[];
  onClose: () => void;
  notify: (msg: string) => void;
}) {
  const [name, setName] = useState(scene?.name ?? '');
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries((scene?.actions ?? []).map((a) => [a.endpointId, a.on ? 'on' : 'off'])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions = Object.entries(choices)
    .filter(([, c]) => c !== 'skip')
    .map(([endpointId, c]) => ({ endpointId, on: c === 'on' }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the scene a name.');
    if (actions.length === 0) return setError('Choose ON or OFF for at least one channel.');
    setBusy(true);
    try {
      const body = { name: name.trim(), icon: null, roomId: scene?.roomId ?? null, actions };
      if (scene) await api(`/api/scenes/${scene.id}`, { method: 'PUT', body });
      else await api(`/api/sites/${siteId}/scenes`, { method: 'POST', body });
      notify(`Saved ${name.trim()}.`);
      onClose();
    } catch {
      setError('Could not save the scene. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!scene || !window.confirm(`Delete the scene "${scene.name}"?`)) return;
    await api(`/api/scenes/${scene.id}`, { method: 'DELETE' }).catch(() => undefined);
    notify(`Deleted ${scene.name}.`);
    onClose();
  }

  const row = (ep: EndpointView) => {
    const c = choices[ep.id] ?? 'skip';
    const opt = (value: Choice, label: string) => (
      <button
        type="button"
        onClick={() => setChoices((s) => ({ ...s, [ep.id]: value }))}
        aria-pressed={c === value}
        className={`px-3 py-1 text-xs font-semibold ${c === value ? (value === 'on' ? 'bg-accent text-white' : 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900') : 'text-slate-500'}`}
      >
        {label}
      </button>
    );
    return (
      <div key={ep.id} className="flex items-center justify-between gap-3 py-1.5">
        <span className="min-w-0 truncate text-sm">{endpointLabel(ep)}</span>
        <span className="flex shrink-0 overflow-hidden rounded-md border border-slate-300 dark:border-slate-700">
          {opt('skip', 'Skip')}
          {opt('on', 'On')}
          {opt('off', 'Off')}
        </span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 rounded-t-2xl bg-white p-4 sm:rounded-2xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{scene ? 'Edit scene' : 'New scene'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500"><Icon name="close" /></button>
        </div>
        <input
          id="scene-name"
          placeholder="Name, e.g. Good night"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {groups.flatMap((g) =>
            g.rooms
              .filter((r) => r.endpoints.some((e) => !e.hidden))
              .map((r) => (
                <div key={r.room?.id ?? 'none'} className="mb-3">
                  <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{r.room?.name ?? 'Not assigned to a room'}</h3>
                  {r.endpoints.filter((e) => !e.hidden).map(row)}
                </div>
              )),
          )}
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {scene ? (
            <button type="button" onClick={remove} className="text-sm text-red-600 dark:text-red-400">Delete scene</button>
          ) : (
            <span className="text-sm text-slate-500">{actions.length} channel{actions.length === 1 ? '' : 's'} in this scene</span>
          )}
          <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Save scene'}
          </button>
        </div>
      </form>
    </div>
  );
}
