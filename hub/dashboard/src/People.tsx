// People in this home: members, pending invites, invite by phone + code, role changes,
// guest access windows, ownership transfer, and leaving.
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assignableRoles, canManageMembers, type InvitationView, type MemberView } from '@sw6/protocol';
import { api, ApiError } from './api';
import { Icon } from './icons';

const field =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent dark:border-slate-700 dark:bg-slate-900';
const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
const ROLE_HINT: Record<string, string> = {
  admin: 'Can also rename rooms and channels and invite members and guests.',
  member: 'Controls everything and creates scenes and automations.',
  guest: 'Controls lights and runs scenes; can have an access window.',
};
const ERRORS: Record<string, string> = {
  already_member: 'That person is already in this home.',
  role_not_allowed: 'Your role cannot give or change that role.',
  invalid_window: 'The access end must be after the start.',
  last_owner: 'You are the only owner. Transfer ownership first.',
  guest_cannot_own: 'Make them a member before transferring ownership.',
  invalid_body: 'Check the phone number format, e.g. +919812345678.',
};

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
/** datetime-local value ↔ ISO in the viewer's local time. */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

type Data = { role: string; members: MemberView[]; invitations: InvitationView[] };

export function People({ siteId, notify }: { siteId: string; notify: (msg: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['members', siteId], queryFn: () => api<Data>(`/api/sites/${siteId}/members`) });
  const [created, setCreated] = useState<{ code: string; phone: string; expiresAt: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['members', siteId] });
  const call = async (path: string, method: string, body?: unknown, ok?: string) => {
    try {
      const r = await api<unknown>(path, { method, body });
      if (ok) notify(ok);
      await refresh();
      return r;
    } catch (err) {
      notify(ERRORS[err instanceof ApiError ? err.code : ''] ?? 'Could not save. Try again.');
      return null;
    }
  };

  if (!q.data) return <p className="text-slate-500">Loading…</p>;
  const { role: myRole, members, invitations } = q.data;
  const manage = canManageMembers(myRole);
  const canAssign = assignableRoles(myRole);
  const isOwner = myRole === 'owner';

  async function leave() {
    if (!window.confirm('Leave this home? You will lose access until someone invites you again.')) return;
    const r = await call(`/api/sites/${siteId}/leave`, 'POST');
    if (r !== null) await qc.invalidateQueries({ queryKey: ['me'] });
  }

  return (
    <div className="flex flex-col gap-8">
      {manage && <InviteForm siteId={siteId} roles={canAssign} onCreated={(c) => { setCreated(c); void refresh(); }} notify={notify} />}
      {created && <CodeCard {...created} onClose={() => setCreated(null)} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">People</h2>
        {members.map((m) => {
          const editable = manage && !m.you && canAssign.includes(m.role);
          return (
            <div key={m.userId} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{m.name}{m.you ? ' (you)' : ''}</p>
                  <p className="text-sm text-slate-500 tabular-nums">{m.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {editable ? (
                    <select id={`role-${m.userId}`} aria-label={`Role for ${m.name}`} className={field} value={m.role} onChange={(e) => call(`/api/sites/${siteId}/members/${m.userId}`, 'PATCH', { role: e.target.value }, `${m.name} is now ${ROLE[e.target.value]}.`)}>
                      {canAssign.map((r) => (
                        <option key={r} value={r}>{ROLE[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold dark:bg-slate-800">{ROLE[m.role] ?? m.role}</span>
                  )}
                  {editable && (
                    <button aria-label={`Remove ${m.name}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" onClick={() => window.confirm(`Remove ${m.name} from this home?`) && call(`/api/sites/${siteId}/members/${m.userId}`, 'DELETE', undefined, `Removed ${m.name}.`)}>
                      <Icon name="trash" className="size-4" />
                    </button>
                  )}
                </div>
              </div>
              {m.role === 'guest' && (
                <GuestWindow
                  m={m}
                  editable={editable}
                  onSave={(validFrom, validUntil) => call(`/api/sites/${siteId}/members/${m.userId}`, 'PATCH', { validFrom, validUntil }, `Access window updated for ${m.name}.`)}
                />
              )}
            </div>
          );
        })}
      </section>

      {manage && invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Waiting to join</h2>
          {invitations.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700">
              <span>
                <span className="tabular-nums">{i.phone}</span> · {ROLE[i.role]} · code valid until {fmt(i.expiresAt)}
              </span>
              <button className="font-medium text-red-600 dark:text-red-400" onClick={() => call(`/api/invitations/${i.id}`, 'DELETE', undefined, 'Invite cancelled.')}>Cancel invite</button>
            </div>
          ))}
        </section>
      )}

      {isOwner && <TransferOwnership members={members.filter((m) => !m.you && m.role !== 'guest')} onTransfer={(m) => call(`/api/sites/${siteId}/transfer`, 'POST', { userId: m.userId }, `${m.name} is now the owner. You are an admin.`).then(() => qc.invalidateQueries({ queryKey: ['me'] }))} />}

      <section className="flex flex-col items-start gap-1">
        <button onClick={leave} className="text-sm font-medium text-red-600 dark:text-red-400">Leave this home</button>
      </section>
    </div>
  );
}

function InviteForm({ siteId, roles, onCreated, notify }: { siteId: string; roles: string[]; onCreated: (c: { code: string; phone: string; expiresAt: string }) => void; notify: (m: string) => void }) {
  const [phone, setPhone] = useState('+91');
  const [role, setRole] = useState(roles.includes('member') ? 'member' : roles[0]);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { phone: phone.replace(/\s/g, ''), role, ...(role === 'guest' ? { validFrom: fromLocalInput(from), validUntil: fromLocalInput(until) } : {}) };
      const r = await api<{ code: string; expiresAt: string }>(`/api/sites/${siteId}/invitations`, { method: 'POST', body });
      onCreated({ code: r.code, phone: body.phone, expiresAt: r.expiresAt });
      setPhone('+91');
      setFrom('');
      setUntil('');
    } catch (err) {
      notify(ERRORS[err instanceof ApiError ? err.code : ''] ?? 'Could not create the invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Invite someone</h2>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          <input id="invite-phone" type="tel" aria-label="Phone number" placeholder="+919812345678" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${field} min-w-0 flex-1`} />
          <select id="invite-role" aria-label="Role" className={field} value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE[r]}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-500">{ROLE_HINT[role]}</p>
        {role === 'guest' && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            Access from
            <input id="invite-from" type="datetime-local" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
            until
            <input id="invite-until" type="datetime-local" className={field} value={until} onChange={(e) => setUntil(e.target.value)} />
            <span className="text-xs text-slate-500">(leave empty for no limit)</span>
          </div>
        )}
        <button type="submit" disabled={busy} className="self-start rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Creating…' : 'Create invite code'}</button>
      </form>
    </section>
  );
}

function CodeCard({ code, phone, expiresAt, onClose }: { code: string; phone: string; expiresAt: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = `Join our SW6 home: on the home Wi-Fi open SW6, choose "I have an invite code", enter ${phone} and code ${code}. Valid until ${fmt(expiresAt)}.`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-accent bg-white p-4 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">Invite code for <span className="tabular-nums">{phone}</span></p>
          <p className="font-mono text-4xl font-bold tracking-[0.25em] select-all">{code}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500"><Icon name="close" /></button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">Shown only once. Send it to them (WhatsApp, call). It works only with their phone number, once, until {fmt(expiresAt)}.</p>
      <button onClick={copy} className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-700">{copied ? 'Copied' : 'Copy message'}</button>
    </section>
  );
}

function GuestWindow({ m, editable, onSave }: { m: MemberView; editable: boolean; onSave: (from: string | null, until: string | null) => void }) {
  const [from, setFrom] = useState(toLocalInput(m.validFrom));
  const [until, setUntil] = useState(toLocalInput(m.validUntil));
  const now = Date.now();
  const status =
    m.validUntil && new Date(m.validUntil).getTime() <= now
      ? 'Access ended'
      : m.validFrom && new Date(m.validFrom).getTime() > now
        ? `Access starts ${fmt(m.validFrom)}`
        : m.validUntil
          ? `Access until ${fmt(m.validUntil)}`
          : 'No time limit';
  if (!editable) return <p className="text-xs text-slate-500">{status}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span className="font-medium">{status}.</span>
      From
      <input id={`from-${m.userId}`} type="datetime-local" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
      until
      <input id={`until-${m.userId}`} type="datetime-local" className={field} value={until} onChange={(e) => setUntil(e.target.value)} />
      <button className="rounded-md border border-slate-300 px-2 py-1 font-semibold dark:border-slate-700" onClick={() => onSave(fromLocalInput(from), fromLocalInput(until))}>Save</button>
    </div>
  );
}

function TransferOwnership({ members, onTransfer }: { members: MemberView[]; onTransfer: (m: MemberView) => void }) {
  const [target, setTarget] = useState('');
  if (members.length === 0) return null;
  const m = members.find((x) => x.userId === target);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Transfer ownership</h2>
      <p className="text-sm text-slate-500">For handover, e.g. from the builder to the buyer. They become the owner and you become an admin.</p>
      <div className="flex flex-wrap gap-2">
        <select id="transfer-to" aria-label="New owner" className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose a member…</option>
          {members.map((x) => (
            <option key={x.userId} value={x.userId}>{x.name} ({x.phone})</option>
          ))}
        </select>
        <button disabled={!m} onClick={() => m && window.confirm(`Make ${m.name} the owner of this home? You will become an admin.`) && onTransfer(m)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-slate-700">
          Transfer
        </button>
      </div>
    </section>
  );
}
