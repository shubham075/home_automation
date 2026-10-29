import { useCallback, useRef, useState } from 'react';
import { CAN, roleRank, type EndpointView, type RunResult, type SceneView } from '@sw6/protocol';
import { api, ApiError, logout } from './api';
import { useQueryClient } from '@tanstack/react-query';
import { Automations } from './Automations';
import { describeRun, endpointLabel, groupByFloor, useEndpoints, useMe, useNotifications, useScenes, useTopology } from './data';
import { Icon } from './icons';
import { Manage } from './Manage';
import { SceneEditor } from './SceneEditor';
import { useLive } from './useLive';

export function Home() {
  const me = useMe();
  const site = me.data?.sites[0];
  const rank = roleRank(site?.role);
  const endpoints = useEndpoints(site?.id);
  const topo = useTopology(site?.id);
  const scenes = useScenes(site?.id);

  const [view, setView] = useState<'home' | 'automations' | 'manage'>('home');
  const [editing, setEditing] = useState<SceneView | 'new' | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  // endpointId → cid of the command waiting for the device's acknowledgement
  const [pending, setPending] = useState<Record<string, string>>({});
  // The ack can arrive over WebSocket before the POST response; remember finished cids.
  const finished = useRef(new Set<string>());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  const connected = useLive(
    site?.id,
    useCallback(
      (r) => {
        finished.current.add(r.cid);
        setPending((p) => {
          if (p[r.endpointId] !== r.cid) return p;
          const { [r.endpointId]: _, ...rest } = p;
          return rest;
        });
        if (r.status !== 'acked' && running === null) {
          const ep = endpoints.data?.find((e) => e.id === r.endpointId);
          notify(`${ep?.name ?? 'Device'} did not respond. Check that the board has power and Wi-Fi.`);
        }
      },
      [endpoints.data, notify, running],
    ),
  );

  async function toggle(ep: EndpointView) {
    if (!ep.deviceOnline || pending[ep.id]) return;
    try {
      const { cid } = await api<{ cid: string }>(`/api/endpoints/${ep.id}/command`, { method: 'POST', body: { op: 'set', on: !ep.on } });
      if (!finished.current.has(cid)) setPending((p) => ({ ...p, [ep.id]: cid }));
    } catch (err) {
      notify(err instanceof ApiError && err.code === 'device_offline' ? `${ep.name} is offline.` : 'Command failed. Try again.');
    }
  }

  async function run(key: string, path: string) {
    setRunning(key);
    try {
      notify(describeRun(await api<RunResult>(path, { method: 'POST' }), endpoints.data));
    } catch {
      notify('Could not run that. Check the hub connection.');
    } finally {
      setRunning(null);
    }
  }

  const visible = (endpoints.data ?? []).filter((e) => !e.hidden);
  const groups = groupByFloor(visible, topo.data);
  const favorites = visible.filter((e) => e.favorite);
  const multiFloor = groups.filter((g) => g.rooms.some((r) => r.endpoints.length)).length > 1;
  const onCount = visible.filter((e) => e.on).length;

  const tile = (ep: EndpointView) => <Tile key={ep.id} ep={ep} pending={!!pending[ep.id]} onToggle={() => toggle(ep)} />;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site?.name ?? 'SW6 Home'}</h1>
          <p className="text-sm text-slate-500">
            {onCount} on · <span className={connected ? 'text-accent' : 'text-amber-600'}>{connected ? 'Live' : 'Reconnecting…'}</span>
          </p>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <TabButton active={view === 'home'} onClick={() => setView('home')}>Home</TabButton>
          <TabButton active={view === 'automations'} onClick={() => setView('automations')}>Automations</TabButton>
          {rank >= CAN.manageRooms && <TabButton active={view === 'manage'} onClick={() => setView('manage')}>Rooms & channels</TabButton>}
          {site && <Bell siteId={site.id} />}
          <button onClick={() => void logout()} className="ml-2 text-slate-500 underline-offset-4 hover:underline">Sign out</button>
        </nav>
      </header>

      {me.isLoading || endpoints.isLoading ? (
        <p className="text-slate-500">Loading your home…</p>
      ) : !site ? (
        <p className="text-slate-500">This account has no homes yet.</p>
      ) : view === 'manage' ? (
        <Manage siteId={site.id} role={site.role} notify={notify} />
      ) : view === 'automations' ? (
        <Automations siteId={site.id} canEdit={rank >= CAN.editScenes} notify={notify} />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">
          No devices yet. Start the simulator with <code className="font-mono">pnpm sim</code> or power on an SW6 board.
        </div>
      ) : (
        <>
          <section aria-label="Scenes" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {(scenes.data ?? []).map((s) => (
              <span key={s.id} className="flex shrink-0 items-center overflow-hidden rounded-full border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
                <button
                  onClick={() => run(s.id, `/api/sites/${site.id}/scenes/${s.id}/run`)}
                  disabled={running !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                >
                  {running === s.id ? <Spinner /> : <Icon name={s.builtin ? 'power' : 'moon'} className="size-4" />}
                  {s.name}
                </button>
                {!s.builtin && rank >= CAN.editScenes && (
                  <button onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} className="border-l border-slate-200 px-2 py-1.5 text-slate-400 dark:border-slate-700">
                    <Icon name="edit" className="size-3.5" />
                  </button>
                )}
              </span>
            ))}
            {rank >= CAN.editScenes && (
              <button onClick={() => setEditing('new')} className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-sm text-slate-500 dark:border-slate-700">
                <Icon name="plus" className="size-4" /> New scene
              </button>
            )}
          </section>

          {favorites.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Favorites</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{favorites.map(tile)}</div>
            </section>
          )}

          {groups.map((g) => {
            const rooms = g.rooms.filter((r) => r.endpoints.length > 0);
            if (!rooms.length) return null;
            return (
              <div key={g.floor?.id ?? 'other'} className="flex flex-col gap-6">
                {multiFloor && <h2 className="border-b border-slate-200 pb-1 text-lg font-semibold dark:border-slate-800">{g.floor?.name ?? 'Other'}</h2>}
                {rooms.map((r) => (
                  <section key={r.room?.id ?? 'none'} className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{r.room?.name ?? 'Not assigned to a room'}</h3>
                      {r.room && r.endpoints.some((e) => e.on) && (
                        <button
                          onClick={() => run(`room-${r.room!.id}`, `/api/rooms/${r.room!.id}/off`)}
                          disabled={running !== null}
                          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:hover:text-white"
                        >
                          {running === `room-${r.room.id}` ? <Spinner /> : <Icon name="power" className="size-3.5" />} All off
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{r.endpoints.map(tile)}</div>
                  </section>
                ))}
              </div>
            );
          })}
        </>
      )}

      {editing && site && (
        <SceneEditor
          siteId={site.id}
          scene={editing === 'new' ? null : editing}
          groups={groups}
          onClose={() => setEditing(null)}
          notify={notify}
        />
      )}

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-30 mx-auto max-w-md rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {toast}
        </div>
      )}
    </main>
  );
}

function Bell({ siteId }: { siteId: string }) {
  const qc = useQueryClient();
  const n = useNotifications(siteId);
  const [open, setOpen] = useState(false);
  const unread = n.data?.unread ?? 0;

  async function toggle() {
    setOpen((o) => !o);
    if (!open && unread) {
      await api(`/api/sites/${siteId}/notifications/read`, { method: 'POST' }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['notifications', siteId] });
    }
  }

  return (
    <span className="relative">
      <button onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative rounded-md p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white">
        <Icon name="bell" />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-red-600 px-1 text-[10px] leading-4 font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          {(n.data?.items ?? []).length === 0 ? (
            <p className="p-2 text-sm text-slate-500">No notifications yet. Automations can send them.</p>
          ) : (
            n.data!.items.map((x) => (
              <div key={x.id} className="rounded-lg p-2 text-sm">
                <p className="font-semibold">{x.title}</p>
                <p className="text-slate-600 dark:text-slate-300">{x.body}</p>
                <p className="text-xs text-slate-400">{new Date(x.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
            ))
          )}
        </div>
      )}
    </span>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-3 py-1.5 font-medium ${active ? 'bg-slate-200 dark:bg-slate-800' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
    >
      {children}
    </button>
  );
}

const Spinner = () => <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="Working" />;

function Tile({ ep, pending, onToggle }: { ep: EndpointView; pending: boolean; onToggle: () => void }) {
  const offline = !ep.deviceOnline;
  return (
    <button
      onClick={onToggle}
      disabled={offline}
      aria-pressed={!!ep.on}
      className={[
        'flex min-h-28 flex-col justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        offline
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900'
          : ep.on
            ? 'border-accent bg-accent text-white'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      ].join(' ')}
    >
      <span className="flex items-center justify-between">
        <Icon name={ep.loadType} className="size-6" />
        {pending && <Spinner />}
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">{endpointLabel(ep)}</span>
        <span className="text-sm opacity-80">
          {offline ? 'Offline' : ep.on ? 'On' : 'Off'}
          {!offline && ep.source === 'physical' ? ' · wall switch' : ''}
        </span>
      </span>
    </button>
  );
}
