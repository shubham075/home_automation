# 02 — MQTT Protocol Spec (v1)

All devices (native Wi-Fi) and the hub backend talk over MQTT. Zigbee devices are adapted from Zigbee2MQTT topics into this model by the backend (see §7).

---

## 1. Topic namespace

```
ha/v1/{siteId}/dev/{deviceId}/{leaf}
```

| Segment | Example | Notes |
|---|---|---|
| `ha/v1` | — | Protocol version. Breaking changes → `ha/v2`, hub serves both during migration |
| `siteId` | `s_7Kq2` | Short site id. Included even on a single-site hub so cloud bridging needs no remapping |
| `deviceId` | `sw6-a1b2c3d4e5f6` | `<model>-<wifi mac, lowercase, no colons>` — stable for the life of the hardware |

### 1.1 Leaves

| Leaf | Direction | QoS | Retained | Purpose |
|---|---|---|---|---|
| `status` | dev → hub | 1 | **yes** | `online` / `offline` (offline is the MQTT Last Will) |
| `meta` | dev → hub | 1 | **yes** | Model, firmware, channel count, capabilities (published on every connect) |
| `state` | dev → hub | 1 | **yes** | Full current state of all channels |
| `cmd` | hub → dev | 1 | no | Commands (set channel, set many, identify, reboot, config) |
| `cmd/ack` | dev → hub | 1 | no | Result of a command, matched by `cid` |
| `event` | dev → hub | 1 | no | Discrete events: input toggled, boot, error, factory reset |
| `telemetry` | dev → hub | 0 | no | Periodic health (60 s): rssi, heap, uptime, chip temp, power |
| `ota` | hub → dev | 1 | no | OTA job: url, version, sha256, signature |
| `ota/progress` | dev → hub | 0 | no | Download/verify/apply progress |
| `config` | hub → dev | 1 | **yes** | Desired configuration (channel restore policy, input mode, names) |

Hub-wide topics:

| Topic | Direction | Purpose |
|---|---|---|
| `ha/v1/bootstrap/{deviceId}/hello` | dev → hub | First contact of an unclaimed device (bootstrap credentials) |
| `ha/v1/bootstrap/{deviceId}/creds` | hub → dev | Per-device credentials + siteId after a successful claim |
| `ha/v1/{siteId}/hub/status` | hub → all | Hub online/offline (retained, LWT) |
| `ha/v1/{siteId}/hub/time` | hub → all | Time sync broadcast (hourly, retained) for devices without NTP |

---

## 2. Payloads (JSON, UTF-8)

Common fields: `ts` = Unix epoch milliseconds (device clock synced via SNTP from hub), `v` = payload schema version.

### 2.1 `meta`
```json
{
  "v": 1,
  "model": "SW6",
  "hw": "proto-a",
  "fw": "0.1.0",
  "mac": "a1:b2:c3:d4:e5:f6",
  "channels": [
    { "ch": 1, "kind": "relay", "input": true, "maxA": 10 },
    { "ch": 2, "kind": "relay", "input": true, "maxA": 10 },
    { "ch": 3, "kind": "relay", "input": true, "maxA": 10 },
    { "ch": 4, "kind": "relay", "input": true, "maxA": 10 },
    { "ch": 5, "kind": "relay", "input": true, "maxA": 10 },
    { "ch": 6, "kind": "relay", "input": true, "maxA": 10 }
  ],
  "caps": ["ota", "identify", "restore_policy", "input_mode"],
  "ts": 1793280000000
}
```

### 2.2 `state`
```json
{
  "v": 1,
  "ch": [true, false, true, false, false, false],
  "src": "physical",
  "chg": [1],
  "seq": 1042,
  "ts": 1793280001234
}
```
- `ch` — index 0 = channel 1.
- `src` — what caused the latest change: `physical` | `cmd` | `restore` | `local_rule`.
- `chg` — channels that changed in this update.
- `seq` — monotonically increasing per boot; hub drops out-of-order updates.

### 2.3 `cmd`
```json
{ "v": 1, "cid": "c_01HF8Z3K", "op": "set", "ch": 3, "on": true, "ts": 1793280002000 }
```

| `op` | Fields | Effect |
|---|---|---|
| `set` | `ch`, `on` | Set one channel |
| `toggle` | `ch` | Toggle one channel |
| `set_many` | `ch: [bool\|null × 6]` | Set several at once (`null` = leave unchanged) — used by scenes |
| `all_off` | — | All relays off |
| `identify` | `sec` | Blink status LED for N seconds (installer finds the module) |
| `reboot` | — | Graceful restart |
| `factory_reset` | `confirm: "YES"` | Wipe NVS, return to provisioning mode |

### 2.4 `cmd/ack`
```json
{ "v": 1, "cid": "c_01HF8Z3K", "ok": true, "state": [true,false,true,false,false,false], "ts": 1793280002041 }
```
On failure: `{ "ok": false, "err": "invalid_channel" }`. Error codes: `invalid_channel`, `invalid_op`, `busy`, `overcurrent`, `unauthorized`.

### 2.5 `event`
```json
{ "v": 1, "type": "input", "ch": 2, "edge": "on", "ts": 1793280003000 }
```
Types: `input`, `boot` (with `reason`: power_on | watchdog | brownout | ota | sw_reset), `error` (with `code`, `msg`), `factory_reset`.

### 2.6 `telemetry`
```json
{ "v": 1, "rssi": -54, "heap": 182340, "up": 86400, "tC": 41.2, "ip": "192.168.1.42", "ts": 1793280060000 }
```

### 2.7 `config` (desired, retained)
```json
{
  "v": 1,
  "rev": 7,
  "restore": ["last","last","off","off","last","on"],
  "inputMode": ["toggle","toggle","toggle","follow","toggle","disabled"],
  "telemetrySec": 60
}
```
- `restore`: after a power cut — `last` (previous state), `off`, `on`.
- `inputMode`: `toggle` (any flip of the wall switch toggles the relay, works with 2-way wiring), `follow` (relay = switch position), `disabled`.
- The device reports the applied `rev` in `meta`, so the hub knows when config has converged.

### 2.8 `ota`
```json
{
  "v": 1,
  "job": "ota_9f2c",
  "ver": "0.2.0",
  "url": "https://hub.local/ota/sw6/0.2.0.bin",
  "size": 1048576,
  "sha256": "3b1f…",
  "sig": "MEUCIQ…"
}
```
`ota/progress`: `{ "job":"ota_9f2c", "phase":"download|verify|apply|done|failed", "pct":42, "err":null }`

---

## 3. Command lifecycle & timing

| Step | Timeout | On timeout |
|---|---|---|
| Hub publishes `cmd` | — | — |
| Device `cmd/ack` | 3 s | Hub retries once with the same `cid` (device de-duplicates the last 16 `cid`s) |
| Second ack wait | 3 s | Command marked `timeout`; UI reverts the optimistic toggle and shows a warning |

## 4. Connection rules (device)

- MQTT keepalive 30 s; LWT = `status: offline` (retained).
- On connect: publish `status: online` → `meta` → `state`, then subscribe to `cmd`, `config`, `ota`.
- Reconnect backoff: 1, 2, 4, 8, 16, max 30 s (+ random jitter 0–1 s).
- Physical inputs never wait on the network (principle P1).
- Client id = `deviceId`; clean session = false (so QoS 1 commands queued during a short blip are delivered).

## 5. Broker authentication & ACL (Mosquitto Dynamic Security)

Anonymous clients are refused. The backend manages every login and role live through the `$CONTROL/dynamic-security/v1` API (`hub/backend/src/dynsec.ts`), so adding a device never restarts the broker.

| Login | Created by | Client id | Allowed |
|---|---|---|---|
| `hub-backend` | `pnpm hub:up` (first run) | any | `$CONTROL/dynamic-security/#`, publish + subscribe `ha/v1/#` |
| `bootstrap` (shared) | backend on start | must equal the device id | publish `ha/v1/bootstrap/%c/hello`, subscribe `ha/v1/bootstrap/%c/creds` only |
| `<deviceId>` (one per board) | backend when credentials are issued | locked to `<deviceId>` | publish + subscribe `ha/v1/{siteId}/dev/{deviceId}/#`, subscribe `ha/v1/{siteId}/hub/#` |

`%c` is the connecting client id. A board using the shared bootstrap login can therefore only announce itself and only read its own credentials (verified: subscribing to another board's `creds` topic is denied).

### Bootstrap sequence

1. Board without stored credentials connects as `bootstrap` with client id = its device id (`sw6-<mac>`), clean session.
2. Publishes `hello` `{v, model, mac, fw, ts}`. The hub checks `deviceId == model + mac`.
3. Hub issues credentials: creates role `device:<id>` and client `<id>` with a random 192-bit password, stores only an Argon2 hash in `device_credential`, revokes older ones.
4. Hub publishes `creds` `{v, siteId, username, password, ts}` (QoS 1, not retained).
5. Board saves them to NVS and reconnects as itself. If a later login is refused (code 4/5), it deletes them and bootstraps again.

Approval: in dev, `DEV_AUTO_APPROVE_SITE` approves new boards into that site. In production that variable is empty, and credentials are issued only by the BLE claim step (proof of possession, W2). Hellos are rate-limited to one credential issue per board per 30 s.

> Bench caveat: until the TLS listener (8883) lands before the pilot, credentials cross the LAN in clear text.

## 6. Versioning

- Additive fields → same `v`; consumers must ignore unknown fields.
- Removing/renaming fields → bump `v` in the payload; topic version `v1` only changes for structural changes.
- The shared `packages/protocol` TS package holds zod schemas for every payload; firmware mirrors them in `protocol.h`.

## 7. Zigbee2MQTT adapter mapping

| Zigbee2MQTT | Mapped to |
|---|---|
| `zigbee2mqtt/bridge/devices` | Device registry upsert (`protocol = zigbee`, `ieee_addr`) |
| `zigbee2mqtt/{friendly_name}` (state JSON) | `endpoint_state` updates; each exposed feature → one `endpoint` |
| `zigbee2mqtt/{friendly_name}/availability` | `device.status` |
| Our `cmd` for a zigbee endpoint | Published to `zigbee2mqtt/{friendly_name}/set` (`{"state_l1":"ON"}`) |

Zigbee devices never see the `ha/v1` namespace. The adapter makes them look the same as native devices to the rest of the backend.
