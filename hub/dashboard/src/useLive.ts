// Live updates over WebSocket, merged straight into the React Query cache.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EndpointView, ServerMessage } from '@sw6/protocol';
import { getToken } from './api';

type CommandResult = Extract<ServerMessage, { type: 'command.result' }>;

export function useLive(siteId: string | undefined, onCommandResult: (r: CommandResult) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const onResult = useRef(onCommandResult);
  onResult.current = onCommandResult;

  useEffect(() => {
    if (!siteId) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let closed = false;
    const key = ['endpoints', siteId];

    const update = (fn: (list: EndpointView[]) => EndpointView[]) =>
      qc.setQueryData<EndpointView[]>(key, (old) => (old ? fn(old) : old));

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken() ?? '')}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        qc.invalidateQueries({ queryKey: key }); // catch up on anything missed while disconnected
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'endpoints.changed') {
          const byId = new Map(msg.endpoints.map((x) => [x.id, x]));
          update((list) => {
            const merged = list.map((x) => byId.get(x.id) ?? x);
            const known = new Set(list.map((x) => x.id));
            return [...merged, ...msg.endpoints.filter((x) => !known.has(x.id))];
          });
        } else if (msg.type === 'device.status') {
          update((list) => list.map((x) => (x.deviceId === msg.deviceId ? { ...x, deviceOnline: msg.online } : x)));
        } else if (msg.type === 'command.result') {
          onResult.current(msg);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };
    open();

    return () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [siteId, qc]);

  return connected;
}
