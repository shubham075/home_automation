import { useQuery } from '@tanstack/react-query';
import type { AutomationView, EndpointView, NotificationView, RunResult, SceneView, Topology } from '@sw6/protocol';
import { api, type Me } from './api';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me') });

export const useEndpoints = (siteId?: string) =>
  useQuery({
    queryKey: ['endpoints', siteId],
    enabled: !!siteId,
    queryFn: () => api<{ endpoints: EndpointView[] }>(`/api/sites/${siteId}/endpoints`).then((r) => r.endpoints),
  });

export const useTopology = (siteId?: string) =>
  useQuery({ queryKey: ['topology', siteId], enabled: !!siteId, queryFn: () => api<Topology>(`/api/sites/${siteId}/topology`) });

export const useScenes = (siteId?: string) =>
  useQuery({
    queryKey: ['scenes', siteId],
    enabled: !!siteId,
    queryFn: () => api<{ scenes: SceneView[] }>(`/api/sites/${siteId}/scenes`).then((r) => r.scenes),
  });

export const useAutomations = (siteId?: string) =>
  useQuery({
    queryKey: ['automations', siteId],
    enabled: !!siteId,
    queryFn: () => api<{ automations: AutomationView[] }>(`/api/sites/${siteId}/automations`).then((r) => r.automations),
  });

export const useNotifications = (siteId?: string) =>
  useQuery({
    queryKey: ['notifications', siteId],
    enabled: !!siteId,
    queryFn: () => api<{ unread: number; items: NotificationView[] }>(`/api/sites/${siteId}/notifications`),
  });

export type RoomGroup = { room: Topology['rooms'][number] | null; endpoints: EndpointView[] };
export type FloorGroup = { floor: Topology['floors'][number] | null; rooms: RoomGroup[] };

/** Floors (by level) → rooms (by sort order) → endpoints. Unplaced items go last. */
export function groupByFloor(endpoints: EndpointView[], topo: Topology | undefined): FloorGroup[] {
  const byRoom = new Map<string | null, EndpointView[]>();
  for (const ep of endpoints) {
    const key = ep.room?.id ?? null;
    byRoom.set(key, [...(byRoom.get(key) ?? []), ep]);
  }
  const rooms = topo?.rooms ?? [];
  const floors: FloorGroup[] = (topo?.floors ?? []).map((floor) => ({
    floor,
    rooms: rooms.filter((r) => r.floorId === floor.id).map((room) => ({ room, endpoints: byRoom.get(room.id) ?? [] })),
  }));
  const loose = rooms.filter((r) => !r.floorId).map((room) => ({ room, endpoints: byRoom.get(room.id) ?? [] }));
  const unassigned = byRoom.get(null) ?? [];
  if (loose.length || unassigned.length) {
    floors.push({ floor: null, rooms: [...loose, ...(unassigned.length ? [{ room: null, endpoints: unassigned }] : [])] });
  }
  return floors;
}

/** Unplaced channels from different boards share names like "Channel 3"; add the board's short id. */
export const endpointLabel = (ep: EndpointView) => (ep.room ? ep.name : `${ep.name} · ${ep.deviceId.slice(-4)}`);

export function describeRun(run: RunResult, endpoints: EndpointView[] | undefined) {
  const ok = run.results.filter((r) => r.status === 'acked').length;
  if (run.results.length === 0) return `${run.name}: nothing to switch.`;
  if (ok === run.results.length) return `${run.name}: done.`;
  const missed = run.results
    .filter((r) => r.status !== 'acked')
    .map((r) => {
      const ep = endpoints?.find((e) => e.id === r.endpointId);
      const where = ep?.room ? ` (${ep.room.name})` : '';
      return `${ep ? endpointLabel(ep) : 'Unknown'}${where}${r.status === 'offline' ? ' is offline' : ''}`;
    });
  return `${run.name}: ${ok} of ${run.results.length} done. Not responding: ${missed.join(', ')}.`;
}
