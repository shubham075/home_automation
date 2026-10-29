// Messages the hub pushes to apps over WebSocket (/ws).
export type EndpointView = {
  id: string;
  deviceId: string;
  channel: number;
  kind: string;
  name: string;
  loadType: string;
  room: { id: string; name: string } | null;
  deviceOnline: boolean;
  on: boolean | null;
  changedAt: string | null;
  source: string | null;
};

export type ServerMessage =
  | { type: 'endpoints.changed'; endpoints: EndpointView[] }
  | { type: 'device.status'; deviceId: string; online: boolean }
  | { type: 'command.result'; cid: string; endpointId: string; status: 'acked' | 'failed' | 'timeout'; error?: string };
