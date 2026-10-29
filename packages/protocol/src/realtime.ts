// Shapes the hub API and WebSocket (/ws) send to apps.

export const LOAD_TYPES = ['light', 'fan', 'socket', 'ac', 'geyser', 'pump', 'other'] as const;
export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'office', 'lobby', 'outdoor', 'other'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];
export type RoomType = (typeof ROOM_TYPES)[number];

/**
 * Site roles ranked for permission checks (docs/03-er-model.md §7).
 * 0 guest: control, run scenes · 1 member: + edit scenes · 2 admin/technician: + rooms, channels, board config
 * · 3 owner/org admin: + members, devices, ownership.
 */
const RANK: Record<string, number> = {
  guest: 0,
  member: 1,
  admin: 2,
  owner: 3,
  'org:technician': 2,
  'org:org_admin': 3,
  'org:org_owner': 3,
};
export const roleRank = (role: string | null | undefined) => (role ? (RANK[role] ?? -1) : -1);
export const CAN = { control: 0, editScenes: 1, manageRooms: 2 } as const;

export type EndpointView = {
  id: string;
  deviceId: string;
  channel: number;
  kind: string;
  name: string;
  loadType: string;
  room: { id: string; name: string } | null;
  favorite: boolean;
  hidden: boolean;
  restorePolicy: string;
  deviceOnline: boolean;
  /** Board has not yet confirmed the latest config (e.g. a power-cut policy change). */
  configPending: boolean;
  on: boolean | null;
  changedAt: string | null;
  source: string | null;
};

export type Topology = {
  /** Used for sunrise / sunset automations. */
  location: { lat: number | null; lng: number | null; timezone: string };
  floors: { id: string; name: string; level: number }[];
  rooms: { id: string; name: string; type: string; floorId: string | null; sortOrder: number }[];
};

export type SceneAction = { endpointId: string; on: boolean };

export type SceneView = {
  id: string; // "all-off" for the built-in scene
  name: string;
  icon: string | null;
  roomId: string | null;
  builtin: boolean;
  actions: SceneAction[];
};

export type ActionResult = { endpointId: string; status: 'acked' | 'failed' | 'timeout' | 'offline' };
export type RunResult = { name: string; results: ActionResult[] };

export type ServerMessage =
  | { type: 'endpoints.changed'; endpoints: EndpointView[] }
  | { type: 'device.status'; deviceId: string; online: boolean }
  | { type: 'command.result'; cid: string; endpointId: string; status: 'acked' | 'failed' | 'timeout'; error?: string }
  | { type: 'topology.changed' }
  | { type: 'scenes.changed' }
  | { type: 'automations.changed' }
  | { type: 'notification'; title: string; body: string };
