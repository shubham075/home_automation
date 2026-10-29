// Installer / admin screen: floors, rooms and per-channel settings. Changes save as you go.
import { useEffect, useState, type FormEvent } from 'react';
import { LOAD_TYPES, ROOM_TYPES, type EndpointView, type Topology } from '@sw6/protocol';
import { api, ApiError } from './api';
import { useEndpoints, useTopology } from './data';
import { Icon, LOAD_LABEL, ROOM_LABEL } from './icons';

const field =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900';
const iconBtn = 'rounded-md p-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-800';

/** Text input that saves on blur or Enter, only when the value changed. */
function NameInput({ id, value, onSave, label }: { id: string; value: string; onSave: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  return (
    <input
      id={id}
      aria-label={label}
      value={draft}
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={`${field} min-w-0 flex-1`}
    />
  );
}

export function Manage({ siteId, notify }: { siteId: string; notify: (msg: string) => void }) {
  const topo = useTopology(siteId);
  const endpoints = useEndpoints(siteId);

  // Every change is pushed back over WebSocket, so no local cache updates are needed here.
  const call = async (path: string, method: string, body?: unknown, okMsg?: string) => {
    try {
      await api(path, { method, body });
      if (okMsg) notify(okMsg);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      notify(
        code === 'floor_not_empty'
          ? 'Move or delete the rooms on this floor first.'
          : code === 'forbidden'
            ? 'Your role cannot change this. Ask the home owner.'
            : 'Could not save. Check the hub connection and try again.',
      );
    }
  };

  if (!topo.data || !endpoints.data) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-10">
      <LocationSection siteId={siteId} topo={topo.data} call={call} />
      <RoomsSection siteId={siteId} topo={topo.data} call={call} />
      <ChannelsSection topo={topo.data} endpoints={endpoints.data} call={call} />
    </div>
  );
}

type Call = (path: string, method: string, body?: unknown, okMsg?: string) => Promise<void>;

function LocationSection({ siteId, topo, call }: { siteId: string; topo: Topology; call: Call }) {
  const [lat, setLat] = useState(topo.location.lat?.toString() ?? '');
  const [lng, setLng] = useState(topo.location.lng?.toString() ?? '');
  const save = (e: FormEvent) => {
    e.preventDefault();
    const [a, b] = [Number(lat), Number(lng)];
    if (!lat || !lng || Number.isNaN(a) || Number.isNaN(b)) return;
    void call(`/api/sites/${siteId}`, 'PATCH', { lat: a, lng: b }, 'Location saved. Sunrise and sunset times now use it.');
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Location</h2>
      <p className="text-sm text-slate-500">Used for sunrise and sunset automations. Copy the coordinates from Google Maps (long-press the home). Time zone: {topo.location.timezone}.</p>
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <input id="site-lat" inputMode="decimal" placeholder="Latitude, e.g. 12.9716" value={lat} onChange={(e) => setLat(e.target.value)} className={`${field} w-44`} />
        <input id="site-lng" inputMode="decimal" placeholder="Longitude, e.g. 77.5946" value={lng} onChange={(e) => setLng(e.target.value)} className={`${field} w-44`} />
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700">Save location</button>
      </form>
    </section>
  );
}

function RoomsSection({ siteId, topo, call }: { siteId: string; topo: Topology; call: Call }) {
  const [roomName, setRoomName] = useState('');
  const [roomType, setRoomType] = useState<string>('other');
  const [roomFloor, setRoomFloor] = useState<string>(topo.floors[0]?.id ?? '');
  const [floorName, setFloorName] = useState('');

  const ordered = topo.rooms; // already sorted by sortOrder
  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void call(`/api/sites/${siteId}/rooms/order`, 'POST', { roomIds: ids });
  };

  const addRoom = (e: FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    void call(`/api/sites/${siteId}/rooms`, 'POST', { name: roomName.trim(), type: roomType, floorId: roomFloor || null }, `Added ${roomName.trim()}.`);
    setRoomName('');
  };
  const addFloor = (e: FormEvent) => {
    e.preventDefault();
    if (!floorName.trim()) return;
    const level = Math.max(-1, ...topo.floors.map((f) => f.level)) + 1;
    void call(`/api/sites/${siteId}/floors`, 'POST', { name: floorName.trim(), level }, `Added ${floorName.trim()}.`);
    setFloorName('');
  };

  const groups = [...topo.floors.map((f) => ({ floor: f as Topology['floors'][number] | null })), { floor: null }];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Floors and rooms</h2>
      {groups.map(({ floor }) => {
        const rooms = ordered.filter((r) => r.floorId === (floor?.id ?? null));
        if (!floor && rooms.length === 0) return null;
        return (
          <div key={floor?.id ?? 'none'} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              {floor ? (
                <>
                  <NameInput id={`floor-${floor.id}`} label="Floor name" value={floor.name} onSave={(name) => call(`/api/floors/${floor.id}`, 'PATCH', { name })} />
                  <button
                    className={iconBtn}
                    aria-label={`Delete ${floor.name}`}
                    disabled={rooms.length > 0}
                    title={rooms.length ? 'Move or delete its rooms first' : 'Delete floor'}
                    onClick={() => call(`/api/floors/${floor.id}`, 'DELETE', undefined, `Deleted ${floor.name}.`)}
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </>
              ) : (
                <span className="text-sm font-medium text-slate-500">Rooms without a floor</span>
              )}
            </div>
            {rooms.map((r) => {
              const idx = ordered.indexOf(r);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 pl-2">
                  <NameInput id={`room-${r.id}`} label="Room name" value={r.name} onSave={(name) => call(`/api/rooms/${r.id}`, 'PATCH', { name })} />
                  <select id={`room-type-${r.id}`} aria-label="Room type" className={field} value={r.type} onChange={(e) => call(`/api/rooms/${r.id}`, 'PATCH', { type: e.target.value })}>
                    {ROOM_TYPES.map((t) => (
                      <option key={t} value={t}>{ROOM_LABEL[t]}</option>
                    ))}
                  </select>
                  <select id={`room-floor-${r.id}`} aria-label="Floor" className={field} value={r.floorId ?? ''} onChange={(e) => call(`/api/rooms/${r.id}`, 'PATCH', { floorId: e.target.value || null })}>
                    {topo.floors.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                    <option value="">No floor</option>
                  </select>
                  <button className={iconBtn} aria-label={`Move ${r.name} up`} disabled={idx === 0} onClick={() => move(r.id, -1)}><Icon name="up" className="size-4" /></button>
                  <button className={iconBtn} aria-label={`Move ${r.name} down`} disabled={idx === ordered.length - 1} onClick={() => move(r.id, 1)}><Icon name="down" className="size-4" /></button>
                  <button
                    className={iconBtn}
                    aria-label={`Delete ${r.name}`}
                    onClick={() => window.confirm(`Delete ${r.name}? Its channels and scenes stay, without a room.`) && call(`/api/rooms/${r.id}`, 'DELETE', undefined, `Deleted ${r.name}.`)}
                  >
                    <Icon name="trash" className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      <form onSubmit={addRoom} className="flex flex-wrap items-center gap-2">
        <input id="new-room-name" placeholder="New room, e.g. Guest Bedroom" value={roomName} maxLength={40} onChange={(e) => setRoomName(e.target.value)} className={`${field} min-w-0 flex-1`} />
        <select id="new-room-type" aria-label="Room type" className={field} value={roomType} onChange={(e) => setRoomType(e.target.value)}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>{ROOM_LABEL[t]}</option>
          ))}
        </select>
        <select id="new-room-floor" aria-label="Floor" className={field} value={roomFloor} onChange={(e) => setRoomFloor(e.target.value)}>
          {topo.floors.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
          <option value="">No floor</option>
        </select>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white">Add room</button>
      </form>
      <form onSubmit={addFloor} className="flex flex-wrap items-center gap-2">
        <input id="new-floor-name" placeholder="New floor, e.g. First, Terrace" value={floorName} maxLength={40} onChange={(e) => setFloorName(e.target.value)} className={`${field} min-w-0 flex-1`} />
        <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700">Add floor</button>
      </form>
    </section>
  );
}

function ChannelsSection({ topo, endpoints, call }: { topo: Topology; endpoints: EndpointView[]; call: Call }) {
  const byDevice = new Map<string, EndpointView[]>();
  for (const ep of endpoints) byDevice.set(ep.deviceId, [...(byDevice.get(ep.deviceId) ?? []), ep]);
  const patch = (id: string, body: Record<string, unknown>) => call(`/api/endpoints/${id}`, 'PATCH', body);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Channels</h2>
        <p className="text-sm text-slate-500">Name each channel after the load it switches and put it in its room. "After power cut" decides what each relay does when electricity comes back.</p>
      </div>
      {[...byDevice].map(([deviceId, eps]) => (
        <div key={deviceId} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-mono font-medium">{deviceId}</span>
            <span className="flex items-center gap-2">
              {eps.some((e) => e.configPending) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">Syncing to board…</span>}
              <span className={eps[0].deviceOnline ? 'text-accent' : 'text-slate-400'}>{eps[0].deviceOnline ? 'Online' : 'Offline'}</span>
            </span>
          </div>
          {eps.map((ep) => (
            <div key={ep.id} className={`flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800 ${ep.hidden ? 'opacity-50' : ''}`}>
              <span className="w-8 text-xs text-slate-500 tabular-nums">Ch {ep.channel}</span>
              <NameInput id={`ep-name-${ep.id}`} label={`Channel ${ep.channel} name`} value={ep.name} onSave={(name) => patch(ep.id, { name })} />
              <select id={`ep-room-${ep.id}`} aria-label="Room" className={field} value={ep.room?.id ?? ''} onChange={(e) => patch(ep.id, { roomId: e.target.value || null })}>
                <option value="">No room</option>
                {topo.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <select id={`ep-load-${ep.id}`} aria-label="Load type" className={field} value={ep.loadType} onChange={(e) => patch(ep.id, { loadType: e.target.value })}>
                {LOAD_TYPES.map((t) => (
                  <option key={t} value={t}>{LOAD_LABEL[t]}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                After power cut
                <select id={`ep-restore-${ep.id}`} className={field} value={ep.restorePolicy} onChange={(e) => patch(ep.id, { restorePolicy: e.target.value })}>
                  <option value="last">Same as before</option>
                  <option value="off">Off</option>
                  <option value="on">On</option>
                </select>
              </label>
              <button className={`${iconBtn} ${ep.favorite ? 'text-amber-500' : ''}`} aria-pressed={ep.favorite} aria-label="Favorite" onClick={() => patch(ep.id, { favorite: !ep.favorite })}>
                <Icon name="star" className="size-4" />
              </button>
              <button className={`${iconBtn} ${ep.hidden ? 'text-slate-900 dark:text-white' : ''}`} aria-pressed={ep.hidden} aria-label="Hide from home screen" onClick={() => patch(ep.id, { hidden: !ep.hidden })}>
                <Icon name="eyeOff" className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
