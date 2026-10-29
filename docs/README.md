# Home Automation Platform — Design Docs

Product: **SW6** 6-channel retrofit smart switch + local hub. Local-first, cloud later. India market.

| Doc | Contents |
|---|---|
| [01-architecture.md](01-architecture.md) | Principles, system diagram, components, ports, security, repo layout, evolution path |
| [02-mqtt-spec.md](02-mqtt-spec.md) | Topic namespace, payload schemas, command lifecycle, ACL, Zigbee2MQTT mapping |
| [03-er-model.md](03-er-model.md) | Multi-tenant ER diagrams (tenancy, topology/devices, control/automation, operations), enums, RBAC matrix, indexes |
| [04-workflows.md](04-workflows.md) | 14 workflow pipelines: device lifecycle, provisioning, commands, physical switch, automations, offline sync, OTA, Zigbee, power cut, customer journey, installer commissioning, CI/CD, hardware, cloud |
| [05-hardware-bom.md](05-hardware-bom.md) | Phase 1/2 bill of materials with INR prices, ESP32-C6 pin plan |
| [06-wiring.md](06-wiring.md) | Safety rules, staged bench build, retrofit wiring |
| [../hardware/sw6/](../hardware/sw6/) | SVG schematics: system overview + one-channel detail |

All diagrams are Mermaid: they render in VS Code (with the *Markdown Preview Mermaid Support* extension) and on GitHub.

## Decisions so far

| Topic | Decision |
|---|---|
| Hero product | 6-channel retrofit relay module (SW6) |
| MCU | ESP32-C6 (Wi-Fi + Zigbee/Thread on one chip) |
| Firmware | ESP-IDF (C) |
| Hub | Docker Compose on the laptop now; Raspberry Pi / mini-PC for pilots |
| Backend | Node.js 22+ + TypeScript (Fastify, Prisma 6, zod, mqtt.js), pnpm workspace |
| DB | SQLite now → Postgres (cloud phase) |
| App | Mobile-first, one codebase: React + TS PWA now → Capacitor Android/iOS before first pilot → Tauri desktop only if needed |
| User auth | Phone + password; biometric unlock in the mobile app; passkeys + SMS OTP once there is a real domain (cloud phase) |
| Broker | Mosquitto |
| Zigbee | Zigbee2MQTT + Sonoff ZBDongle-E (phase 2) |
| Tenancy | Multi-tenant: organization → site → floor → room → device → endpoint |
