// Per-site WebSocket fan-out. Every app connected to a site gets every change on it.
import type { ServerMessage } from '@sw6/protocol';

type Socket = { readyState: number; send(data: string): void; on(event: 'close', cb: () => void): void };

const OPEN = 1;
const rooms = new Map<string, Set<Socket>>();

export function join(socket: Socket, siteIds: string[]) {
  for (const id of siteIds) {
    if (!rooms.has(id)) rooms.set(id, new Set());
    rooms.get(id)!.add(socket);
  }
  socket.on('close', () => {
    for (const id of siteIds) rooms.get(id)?.delete(socket);
  });
}

export function broadcast(siteId: string, msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const s of rooms.get(siteId) ?? []) {
    if (s.readyState === OPEN) s.send(data);
  }
}
