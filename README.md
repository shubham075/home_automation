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
pnpm hub:up        # Mosquitto on :1883
pnpm db:setup      # create SQLite DB + seed demo site and admin
pnpm dev           # backend :8080 + dashboard :5173
```

In a second terminal:

```bash
pnpm sim --count 2
```

Open http://localhost:5173 and sign in with the seed admin from `hub/backend/.env` (`SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD`). Two simulated boards appear with 6 channels each.

Simulator keys: `1`–`6` flip a wall switch, `o` drops the device offline / reconnects, `Tab` switches device, `s` prints status, `q` quits.

Try it from your phone: open `http://<laptop-ip>:5173` on the same Wi-Fi.

## Status

Working end to end: login (JWT), site access control, device auto-registration (dev), app command → MQTT → device ack with retry/timeout, wall-switch changes pushed live to every open app, offline detection via MQTT Last Will.

Not yet: refresh tokens, BLE claim flow, scenes/automations engine, OTA, TLS on the broker, Zigbee2MQTT, firmware, Capacitor app.
