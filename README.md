# SW6 Home Automation Platform

6-channel retrofit smart switch (ESP32-C6) + local hub. Local-first, multi-tenant, cloud later. Built for the Indian market.

Design docs: [docs/README.md](docs/README.md)

## Repository

| Path | What |
|---|---|
| `packages/protocol` | Shared MQTT topics + zod payload schemas + WebSocket message types |
| `hub/backend` | Node.js + TypeScript: Fastify API, MQTT bridge, command service, Prisma (SQLite) |
| `hub/dashboard` | React + Vite PWA (Capacitor mobile wrapper comes before the first pilot) |
| `hub/docker-compose.yml` | Mosquitto broker |
| `tools/device-simulator` | Fake SW6 boards that follow the real MQTT contract |
| `firmware/sw6-esp32c6` | ESP-IDF firmware (placeholder until hardware arrives) |
| `hardware/sw6` | Wiring schematics (SVG) |

## Quickstart (Windows, macOS, Linux)

Needs Node 22+, pnpm, Docker.

```bash
pnpm install
cp hub/backend/.env.example hub/backend/.env
pnpm hub:up        # Mosquitto on :1883 (creates broker admin login on first run)
pnpm db:setup      # apply migrations + seed demo site and admin
pnpm dev           # backend :8080 + dashboard :5173
```

In a second terminal:

```bash
pnpm sim --count 3
```

Open http://localhost:5173 and sign in with the seed admin from `hub/backend/.env` (`SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD`).

New boards must be claimed: the simulator prints each board's QR label text (`SW6:<id>:<setup code>`). In the app open **Rooms & channels → Add board**, type the id and code (or scan a QR on Android Chrome), then name the channels. Press `l` in the simulator to print the labels again.

Each simulated board keeps its broker login in `tools/device-simulator/.sim-creds.json` (like NVS; `pnpm sim --reset` forgets them) and its setup code in `.sim-codes.json` (like the factory partition).

Simulator keys: `1`–`6` flip a wall switch, `o` drops the device offline / reconnects, `Tab` switches device, `s` prints status, `q` quits.

Try it from your phone: open `http://<laptop-ip>:5173` on the same Wi-Fi.

## Status

Last updated: 30 Oct 2026. Everything under "Done" runs end to end against the device simulator and is covered by end-to-end checks (auth 21, rooms and scenes 25, automations 18, claim 18, members 31).

### Done

**Design**
- Architecture, MQTT protocol spec, multi-tenant ER model, 14 workflow pipelines, parts list (₹7–8k prototype), wiring guide and SVG schematics: [docs/](docs/README.md)

**Hub platform**
- pnpm monorepo: shared `@sw6/protocol` (topics, zod schemas, WebSocket types, role ranks)
- Fastify + TypeScript backend, Prisma schema for the whole ER model, SQLite in WAL mode
- MQTT bridge with per-device ordered processing; commands with ack, one retry, timeout
- Live updates to every open app over WebSocket

**Security**
- Users: 15-min access tokens, rotating 30-day refresh tokens with reuse detection, httpOnly cookie on web / body for native, logout
- Login abuse: per-IP rate limit, per-account lockout, constant-time rejection
- Roles: guest < member < admin/technician < owner, enforced on every route
- Broker: Mosquitto Dynamic Security, anonymous refused, per-device logins locked to client id and own topics, bootstrap flow that issues each board its own password

**Features**
- Board claim: QR label (camera on Android Chrome, or typed) + setup code verified by HMAC challenge-response with the board; 5-try lockout; only owner/technician; then name channels and pick rooms in one step
- Remove board: factory reset, login revoked, channels deleted, board claimable again
- People: invite by phone + 6-digit code (single use, 72 h, bound to the phone, burns after 5 wrong tries, stored hashed); accepting signs new people up or existing accounts in; roles owner/admin/member/guest with who-can-assign rules; guest access windows; change role, remove (cuts live connections), leave, cancel invites, transfer ownership (handover)
- Dev shortcut `DEV_AUTO_APPROVE_SITE` (off by default)
- Floors and rooms (create, rename, reorder, delete)
- Channel settings: name, room, load type + icon, favorite, hide, power-cut restore policy pushed to the board
- Scenes: built-in All off, user scenes, per-room All off, per-channel result details
- Wall-switch changes shown live with "wall switch" source; offline detection via Last Will
- Automations: triggers at a time (with weekdays), sunrise/sunset ± offset (site location), channel on/off, board offline for N min; actions switch channels (optional auto-off timer), run a scene, send an in-app notification; optional time window; enable/disable, Run now, last-run result
- In-app notifications with unread badge

**Apps and tools**
- React PWA dashboard: Home, scenes, scene editor, Automations with guided editor, notifications, People, invite-code sign-up, Rooms & channels + site location + add/remove boards (admins)
- Device simulator: bootstrap, stored credentials, config, keyboard wall switches, offline drop

### Remaining

**Next (software, no hardware needed)**
- [ ] Room-limited guests (guest sees only chosen rooms)
- [ ] Invite delivery by SMS / WhatsApp (cloud phase); today the inviter shares the code
- [ ] Push notifications (with the Capacitor app)
- [ ] Automation conditions beyond time window (e.g. only if another channel is off), motion/sensor triggers once sensor boards exist
- [ ] Energy history and charts once metering hardware exists

**Before the first pilot**
- [ ] TLS on the broker (8883, hub-local CA) and HTTPS for the app
- [ ] Capacitor Android/iOS app: BLE Wi-Fi provisioning for factory-fresh boards (ESP-IDF security v2, setup code as PoP), QR scan on iPhone, push, biometric unlock, Keychain/Keystore tokens
- [ ] Backend in Docker on a Raspberry Pi / mini-PC; backups of the SQLite file
- [ ] OTA firmware updates (signed, A/B partitions, rollback)
- [ ] Zigbee2MQTT adapter (Sonoff ZBDongle-E)
- [ ] Unit tests and CI (GitHub Actions); move the e2e checks into the repo

**Hardware and firmware (parts on order)**
- [ ] ESP-IDF firmware for ESP32-C6 matching the simulator contract (`firmware/sw6-esp32c6`)
- [ ] Bench build stages 1–7 (`docs/06-wiring.md`), then perfboard prototype in ABS box
- [ ] Custom PCB v1 (KiCad → JLCPCB), thermal and switching-cycle tests

**Product phase**
- [ ] Cloud: hub cloud agent, remote access, fleet OTA, Postgres, voice assistants
- [ ] Secure boot + flash encryption, Matter, BIS / WPC certification
- [ ] Partner/installer portal, installation jobs, billing

**Known limitations**
- Credentials cross the LAN in clear text until broker TLS lands
- Login lockout counters are in memory and reset on backend restart
- Pending auto-off timers and board-offline timers live in memory; a backend restart drops them
- Missed scheduled runs (hub off at that minute) are skipped, not replayed
- Claim lockout and "recently seen" board tracking are in memory
- Whole-house scenes take ~1.7 s for 12 channels; one message per board (`set_many`) would cut this
