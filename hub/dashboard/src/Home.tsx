import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EndpointView } from '@sw6/protocol';
import { api, ApiError, setToken, type Me } from './api';
import { useLive } from './useLive';

export function Home() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me') });
  const site = me.data?.sites[0];

  const endpoints = useQuery({
    queryKey: ['endpoints', site?.id],
    enabled: !!site,
    queryFn: () => api<{ endpoints: EndpointView[] }>(`/api/sites/${site!.id}/endpoints`).then((r) => r.endpoints),
  });

  // endpointId → cid of the command waiting for the device's acknowledgement
  const [pending, setPending] = useState<Record<string, string>>({});
  // The ack can arrive over WebSocket before the POST response; remember finished cids.
  const finished = useRef(new Set<string>());
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

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
        if (r.status !== 'acked') {
          const ep = endpoints.data?.find((e) => e.id === r.endpointId);
          showToast(`${ep?.name ?? 'Device'} did not respond. Check that the board has power and Wi-Fi.`);
        }
      },
      [endpoints.data],
    ),
  );

  async function toggle(ep: EndpointView) {
    if (!ep.deviceOnline || pending[ep.id]) return;
    try {
      const { cid } = await api<{ cid: string }>(`/api/endpoints/${ep.id}/command`, {
        method: 'POST',
        body: { op: 'set', on: !ep.on },
      });
      if (!finished.current.has(cid)) setPending((p) => ({ ...p, [ep.id]: cid }));
    } catch (err) {
      showToast(err instanceof ApiError && err.code === 'device_offline' ? `${ep.name} is offline.` : 'Command failed. Try again.');
    }
  }

  const groups = new Map<string, EndpointView[]>();
  for (const ep of endpoints.data ?? []) {
    const room = ep.room?.name ?? 'Not assigned to a room';
    groups.set(room, [...(groups.get(room) ?? []), ep]);
  }
  const onCount = endpoints.data?.filter((e) => e.on).length ?? 0;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{site?.name ?? 'SW6 Home'}</h1>
          <p className="text-sm text-slate-500">
            {onCount} on · <span className={connected ? 'text-accent' : 'text-amber-600'}>{connected ? 'Live' : 'Reconnecting…'}</span>
          </p>
        </div>
        <button onClick={() => setToken(null)} className="text-sm text-slate-500 underline-offset-4 hover:underline">
          Sign out
        </button>
      </header>

      {me.isLoading || endpoints.isLoading ? (
        <p className="text-slate-500">Loading your home…</p>
      ) : !site ? (
        <p className="text-slate-500">This account has no homes yet.</p>
      ) : groups.size === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500 dark:border-slate-700">
          No devices yet. Start the simulator with <code className="font-mono">pnpm sim</code> or power on an SW6 board.
        </div>
      ) : (
        [...groups].map(([room, list]) => (
          <section key={room} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{room}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {list.map((ep) => (
                <Tile key={ep.id} ep={ep} pending={!!pending[ep.id]} onToggle={() => toggle(ep)} />
              ))}
            </div>
          </section>
        ))
      )}

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 mx-auto max-w-md rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          {toast}
        </div>
      )}
    </main>
  );
}

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
        <span className="font-semibold">{ep.name}</span>
        {pending && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="Waiting for device" />}
      </span>
      <span className="text-sm opacity-80">
        {offline ? 'Offline' : ep.on ? 'On' : 'Off'}
        {!offline && ep.source === 'physical' ? ' · wall switch' : ''}
      </span>
    </button>
  );
}
