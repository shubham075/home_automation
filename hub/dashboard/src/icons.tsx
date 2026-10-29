// Line icons, 24×24, drawn with currentColor.
const paths: Record<string, string> = {
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z',
  fan: 'M12 10c0-4 1-7 4-7s2 4-2 7M14 12c4 0 7 1 7 4s-4 2-7-2M12 14c0 4-1 7-4 7s-2-4 2-7M10 12c-4 0-7-1-7-4s4-2 7 2M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  socket: 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zM9.5 9v3M14.5 9v3M12 15v1.5',
  ac: 'M12 2v20M4.9 7l14.2 10M19.1 7 4.9 17M9 4l3 2 3-2M9 20l3-2 3 2',
  geyser: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  pump: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 5v7l4 3',
  other: 'M12 3v8M7 6.3a7 7 0 1 0 10 0',
  power: 'M12 3v8M7 6.3a7 7 0 1 0 10 0',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  plus: 'M12 5v14M5 12h14',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.5M6.4 7.4A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 4-1',
  close: 'M6 6l12 12M18 6 6 18',
};

export function Icon({ name, className = 'size-5' }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name] ?? paths.other} />
    </svg>
  );
}

export const LOAD_LABEL: Record<string, string> = {
  light: 'Light',
  fan: 'Fan',
  socket: 'Socket',
  ac: 'AC',
  geyser: 'Geyser',
  pump: 'Pump',
  other: 'Other',
};

export const ROOM_LABEL: Record<string, string> = {
  living: 'Living',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  office: 'Office',
  lobby: 'Lobby',
  outdoor: 'Outdoor',
  other: 'Other',
};
