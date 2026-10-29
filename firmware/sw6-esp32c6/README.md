# SW6 firmware (ESP32-C6, ESP-IDF)

Not scaffolded yet. The code lands once ESP-IDF v5.x is installed and the Phase 1 parts arrive.

It must behave exactly like the simulator in `tools/device-simulator/src/device.ts`, which is the reference implementation of the MQTT contract (`docs/02-mqtt-spec.md`, schemas in `packages/protocol`).

Planned tasks (see `docs/01-architecture.md` §3.1):

| Task | Job |
|---|---|
| `input_task` | 50 Hz mains-pulse detection on 6 inputs, debounce, edge → toggle |
| `relay_ctrl` | Sole owner of relay GPIOs 18–23 (active-LOW), persists state to NVS |
| `net_task` | Wi-Fi state machine, BLE provisioning, reconnect with backoff |
| `mqtt_task` | esp-mqtt client, LWT, `status`/`meta`/`state`/`cmd/ack`/`event` |
| `telemetry_task` | rssi, heap, uptime, chip temperature every 60 s |
| `ota_task` | HTTPS download, sha256 + signature check, A/B partition switch |

Pin plan: `docs/05-hardware-bom.md` §E. Bench stages: `docs/06-wiring.md`.
