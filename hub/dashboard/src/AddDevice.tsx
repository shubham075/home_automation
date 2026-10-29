// Add a board: read its QR label (camera or typed), claim it with proof of possession,
// then name its channels and place them in rooms.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseClaimCode, type Topology } from '@sw6/protocol';
import { api, ApiError } from './api';
import { useEndpoints } from './data';
import { Icon } from './icons';
import { ChannelRow } from './Manage';

// BarcodeDetector is not in TypeScript's DOM lib yet (Chrome on Android ships it).
type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

const field =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900';

const ERRORS: Record<string, string> = {
  invalid_code: 'That does not look like an SW6 label. The board id looks like sw6-025e06000003 and the setup code like K7QM-9XAD.',
  device_not_found: 'This hub has not heard from that board yet. Power it on, make sure it is on the home Wi-Fi, wait 30 seconds and try again.',
  device_not_ready: 'The board is not connected right now. Check its power and Wi-Fi, wait 30 seconds and try again.',
  device_no_response: 'The board did not answer. Check its power and Wi-Fi and try again.',
  wrong_code: 'The setup code does not match this board. Check the label on the board itself.',
  too_many_attempts: 'Too many wrong codes for this board. Wait 10 minutes and try again.',
  claimed_elsewhere: 'This board belongs to another home. Its owner has to remove it first.',
  already_claimed: 'This board is already part of this home.',
  forbidden: 'Only the home owner or an installer can add boards.',
};

export function AddDevice({
  siteId,
  rooms,
  patch,
  onClose,
}: {
  siteId: string;
  rooms: Topology['rooms'];
  patch: (id: string, body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [deviceId, setDeviceId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const canScan = typeof window !== 'undefined' && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;

  const endpoints = useEndpoints(siteId);
  const newChannels = (endpoints.data ?? []).filter((e) => e.deviceId === claimed);

  // Camera scan loop; stops on a valid label or when the sheet closes.
  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current || stopped) return;
        video.current.srcObject = s;
        await video.current.play();
        const loop = async () => {
          if (stopped || !video.current) return;
          const hit = (await detector.detect(video.current).catch(() => [])).map((c) => parseClaimCode(c.rawValue)).find(Boolean);
          if (hit) {
            setDeviceId(hit.deviceId);
            setCode(`${hit.code.slice(0, 4)}-${hit.code.slice(4)}`);
            setScanning(false);
            return;
          }
          raf = requestAnimationFrame(loop);
        };
        void loop();
      })
      .catch(() => {
        setScanning(false);
        setError('Camera not available. Type the board id and setup code from the label instead.');
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning]);

  async function claim(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!parseClaimCode(`${deviceId} ${code}`)) return setError(ERRORS.invalid_code);
    setBusy(true);
    try {
      const res = await api<{ deviceId: string }>(`/api/sites/${siteId}/devices/claim`, { method: 'POST', body: { deviceId: deviceId.trim(), setupCode: code } });
      setClaimed(res.deviceId);
    } catch (err) {
      setError(ERRORS[err instanceof ApiError ? err.code : ''] ?? 'Could not add the board. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{claimed ? 'Name the channels' : 'Add a board'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500"><Icon name="close" /></button>
        </div>

        {!claimed ? (
          <form onSubmit={claim} className="flex flex-col gap-3">
            <ol className="list-decimal pl-5 text-sm text-slate-600 dark:text-slate-300">
              <li>Power the board and connect it to the home Wi-Fi. (Wi-Fi setup over Bluetooth arrives with the mobile app; bench boards are pre-configured.)</li>
              <li>Scan the QR label on the board, or type what is printed under it.</li>
            </ol>
            {canScan && !scanning && (
              <button type="button" onClick={() => setScanning(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Scan QR label</button>
            )}
            {scanning && (
              <div className="flex flex-col gap-2">
                <video ref={video} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" />
                <button type="button" onClick={() => setScanning(false)} className="text-sm text-slate-500">Stop camera</button>
              </div>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium">
              Board id
              <input id="claim-device" placeholder="sw6-025e06000003" autoCapitalize="none" spellCheck={false} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={`${field} font-mono`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Setup code
              <input id="claim-code" placeholder="K7QM-9XAD" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className={`${field} font-mono tracking-widest uppercase`} />
            </label>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={busy} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-60">
              {busy ? 'Checking the board…' : 'Add board'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <span className="font-mono">{claimed}</span> is now part of this home. Name each channel after what it switches and pick its room. You can change this later.
            </p>
            {newChannels.length === 0 ? (
              <p className="text-sm text-slate-500">Waiting for the board to connect with its new login…</p>
            ) : (
              newChannels.map((ep) => <ChannelRow key={ep.id} ep={ep} rooms={rooms} patch={patch} compact />)
            )}
            <button onClick={onClose} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}
