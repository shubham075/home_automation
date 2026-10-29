# 04 — Workflow Pipelines

Runtime flows (how the system behaves) first, then business and engineering pipelines (how you build, install and ship).

| # | Workflow | Type |
|---|---|---|
| W1 | Device lifecycle | State machine |
| W2 | Provisioning & claim (new SW6 joins a site) | Sequence |
| W3 | App command → relay (with ack) | Sequence |
| W4 | Physical switch → relay (local first) | Sequence |
| W5 | Automation engine | Flowchart |
| W6 | Offline, reconnect & state sync | Sequence |
| W7 | OTA firmware update with rollback | Sequence |
| W8 | Zigbee device join | Sequence |
| W9 | Power cut & boot | Flowchart |
| W10 | Customer journey: lead → install → support (B2C & B2B) | Flowchart |
| W11 | Installer on-site commissioning | Flowchart |
| W12 | Engineering pipeline: code → firmware release | Flowchart |
| W13 | Hardware pipeline: breadboard → certified product | Flowchart |
| W14 | Future cloud sync | Sequence |

---

## W1 — Device lifecycle

```mermaid
stateDiagram-v2
  [*] --> Unprovisioned: factory flash
  Unprovisioned --> Provisioning: BLE onboarding started
  Provisioning --> Unprovisioned: timeout / wrong Wi-Fi password
  Provisioning --> Unclaimed: Wi-Fi OK, bootstrap hello sent
  Unclaimed --> Online: claimed by owner/technician, credentials issued
  Online --> Offline: LWT / no heartbeat 90 s
  Offline --> Online: reconnect
  Online --> Updating: OTA job
  Updating --> Online: success (new fw) / rollback (old fw)
  Online --> Error: repeated faults (brown-out, overtemp)
  Error --> Online: recovered
  Online --> Unprovisioned: factory reset (hold button 10 s)
  Online --> Decommissioned: removed from site
  Decommissioned --> [*]
```

---

## W2 — Provisioning & claim

```mermaid
sequenceDiagram
  autonumber
  actor Tech as Owner / Technician
  participant App as Mobile app · Capacitor BLE
  participant Dev as SW6 (ESP32-C6)
  participant MQ as Mosquitto
  participant API as Hub backend
  participant DB as Database

  Note over Dev: First boot → BLE advertising "SW6-E5F6"<br/>status LED blinks blue
  Tech->>App: Add device → scan QR on module (deviceId + PoP code)
  App->>Dev: BLE connect (security v2, PoP from QR)
  App->>Dev: Wi-Fi SSID + password, hub host (sw6hub.local)
  Dev->>Dev: Join Wi-Fi, SNTP time sync
  Dev-->>App: Provisioning success (IP)
  Dev->>MQ: CONNECT user=bootstrap
  Dev->>MQ: PUBLISH ha/v1/bootstrap/sw6-…/hello {mac, model, fw}
  MQ->>API: hello
  API->>DB: upsert DEVICE (status = unclaimed)
  App->>API: POST /sites/{id}/devices/claim {deviceId, popCode}
  API->>API: verify PoP hash · RBAC (owner / technician)
  API->>DB: DEVICE → site, status = provisioning<br/>DEVICE_CREDENTIAL (new password hash)
  API->>MQ: add mqtt user + ACL (dynamic security)
  API->>MQ: PUBLISH bootstrap/sw6-…/creds {siteId, username, password}
  MQ->>Dev: creds
  Dev->>Dev: store creds in NVS (encrypted)
  Dev->>MQ: reconnect as sw6-… → status online, meta, state
  MQ->>API: meta (6 channels)
  API->>DB: create 6 ENDPOINT rows, status = online
  API-->>App: WebSocket: device ready → "Assign channels to rooms"
  Tech->>App: Ch1 = Living / Ceiling light, Ch2 = Living / Fan …
  App->>API: PATCH endpoints
  API->>DB: update ENDPOINT room/name/load_type · AUDIT_LOG device.claim
```

---

## W3 — App command → relay

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant App as PWA
  participant API as Backend
  participant DB as DB
  participant MQ as Mosquitto
  participant Dev as SW6

  U->>App: Tap "Ceiling light" ON
  App->>App: optimistic UI (pending spinner)
  App->>API: POST /endpoints/{id}/command {op:set, on:true}
  API->>API: auth JWT · RBAC (site role) · validate (zod)
  API->>DB: COMMAND (status = pending, cid)
  API->>MQ: PUBLISH …/dev/sw6-…/cmd {cid, op:set, ch:1, on:true} QoS1
  API->>DB: COMMAND status = sent
  MQ->>Dev: cmd
  Dev->>Dev: relay_ctrl: GPIO → relay ON, persist NVS
  Dev->>MQ: cmd/ack {cid, ok:true, state}
  Dev->>MQ: state (retained) {ch:[1,0,…], src:cmd}
  MQ->>API: ack + state
  API->>DB: COMMAND acked · ENDPOINT_STATE · TELEMETRY(on=1) · AUDIT_LOG
  API-->>App: WebSocket endpoint.state (to every client on this site)
  App->>U: ✓ ON (confirmed)

  alt no ack in 3 s
    API->>MQ: resend same cid
    alt still no ack in 3 s
      API->>DB: COMMAND timeout
      API-->>App: command.failed → revert toggle, show "Device not responding"
    end
  end
```

---

## W4 — Physical switch → relay (local first)

```mermaid
sequenceDiagram
  autonumber
  actor P as Person at wall switch
  participant IN as PC817 input
  participant FW as SW6 firmware
  participant R as Relay
  participant MQ as Mosquitto
  participant API as Backend
  participant App as All open apps

  P->>IN: flip switch (230 V present / absent)
  IN->>FW: 50 Hz pulse train starts / stops
  FW->>FW: input_task: pulses present for 30 ms → edge detected (debounced)
  FW->>R: toggle relay immediately (≈ 40 ms, no network involved)
  FW->>FW: persist state (NVS, rate-limited)
  opt network available
    FW->>MQ: event {type:input, ch:2, edge:on}
    FW->>MQ: state {src:physical}
    MQ->>API: event + state
    API->>API: update ENDPOINT_STATE (source = physical)
    API->>API: evaluate automations (endpoint_state triggers)
    API-->>App: live update
  end
  Note over FW,R: If Wi-Fi/hub is down, steps 1–5 still work.<br/>State is published after reconnect (W6).
```

---

## W5 — Automation engine

```mermaid
flowchart TD
  T1["MQTT state / event<br/>(endpoint_state, motion, threshold)"] --> Q
  T2["Scheduler tick (every 1 s)<br/>cron · sunrise/sunset"] --> Q
  T3["Device status change<br/>(offline for N sec)"] --> Q
  Q["Trigger bus (in-process queue)"] --> M{"Find enabled automations<br/>whose trigger matches"}
  M -- none --> X["discard"]
  M -- match --> CD{"Cooldown<br/>elapsed?"}
  CD -- no --> S1["AUTOMATION_RUN<br/>skipped_cooldown"]
  CD -- yes --> C{"All conditions true?<br/>time window · other endpoint states · day of week"}
  C -- no --> S2["AUTOMATION_RUN<br/>skipped_condition"]
  C -- yes --> A["Execute actions in order"]
  A --> A1["set_endpoint → Command service (W3)"]
  A --> A2["run_scene → set_many per device"]
  A --> A3["delay N sec"]
  A --> A4["notify → NOTIFICATION + WebSocket"]
  A1 & A2 & A3 & A4 --> R["AUTOMATION_RUN<br/>success / partial / failed<br/>+ AUDIT_LOG"]
```

Example: *"After sunset, if motion in the corridor → corridor light ON for 3 min, unless it was already ON."*
`trigger = motion(pir-corridor)`, `conditions = [sun.after(sunset), endpoint(corridor-light).on == false]`, `actions = [set(on), delay(180), set(off)]`.

---

## W6 — Offline, reconnect & state sync

```mermaid
sequenceDiagram
  autonumber
  participant Dev as SW6
  participant MQ as Mosquitto
  participant API as Backend
  participant App as PWA

  Note over Dev,MQ: Wi-Fi drops
  MQ->>MQ: keepalive expires (45 s) → publish LWT status=offline (retained)
  MQ->>API: status offline
  API->>API: DEVICE offline · endpoints show "unavailable"
  API-->>App: device.offline (greyed tiles)
  Note over Dev: Wall switches keep working locally (W4)<br/>state changes kept in RAM + NVS
  Dev->>Dev: reconnect with backoff 1 s → 30 s + jitter
  Dev->>MQ: CONNECT (clean session = false)
  MQ->>Dev: queued QoS1 cmds (if any, < session expiry)
  Dev->>Dev: drop cmds older than 30 s (stale protection)
  Dev->>MQ: status online · meta · state (authoritative, seq reset)
  MQ->>API: state
  API->>API: device state wins (it is the physical truth)<br/>reconcile ENDPOINT_STATE, log changes as source=physical
  API->>MQ: config (retained) if config_rev_applied < desired
  API-->>App: device.online + fresh state
  opt hub offline > 24 h
    API->>API: run missed schedules? → NO (skip, log "missed")
  end
```

---

## W7 — OTA firmware update with rollback

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin / Owner
  participant API as Backend (OTA module)
  participant MQ as Mosquitto
  participant Dev as SW6
  participant FS as Hub file server

  A->>API: Upload release 0.2.0 (bin + sha256 + signature)
  API->>API: verify signature with public key · store FIRMWARE_RELEASE
  A->>API: Update device(s) → OTA_JOB queued
  API->>API: preflight: device online · fw < 0.2.0 · not mid-command
  API->>MQ: …/ota {job, url, sha256, sig}
  MQ->>Dev: ota
  Dev->>FS: HTTPS GET 0.2.0.bin (stream to inactive partition)
  Dev->>MQ: ota/progress download 0→100 %
  Dev->>Dev: verify sha256 + ECDSA signature
  alt verification fails
    Dev->>MQ: ota/progress failed (bad_signature)
    API->>API: OTA_JOB failed
  else ok
    Dev->>Dev: set boot partition = B · reboot (relays keep state via NVS restore)
    Dev->>Dev: new fw self-test: Wi-Fi + MQTT connect within 60 s
    alt self-test passes
      Dev->>Dev: mark app valid (cancel rollback)
      Dev->>MQ: meta {fw:0.2.0} · ota/progress done
      API->>API: OTA_JOB success · DEVICE.fw_version
    else self-test fails / crash loop
      Dev->>Dev: bootloader rolls back to partition A
      Dev->>MQ: event boot {reason: ota_rollback}
      API->>API: OTA_JOB rolled_back · NOTIFICATION
    end
  end
```

Rollout rule for pilots: update **1 device → wait 24 h → rest of the site**. In the cloud phase: staged rollout 1 % → 10 % → 100 % by `channel` (beta/stable).

---

## W8 — Zigbee device join (phase 2)

```mermaid
sequenceDiagram
  autonumber
  actor U as Technician
  participant App as PWA
  participant API as Backend
  participant MQ as Mosquitto
  participant Z as Zigbee2MQTT
  participant ZD as Zigbee device

  U->>App: Add Zigbee device
  App->>API: POST /hubs/{id}/zigbee/permit-join {sec:120}
  API->>MQ: zigbee2mqtt/bridge/request/permit_join {value:true, time:120}
  MQ->>Z: permit join
  U->>ZD: put device in pairing mode
  ZD->>Z: join + interview
  Z->>MQ: zigbee2mqtt/bridge/event {type: device_interview, status: successful}
  Z->>MQ: zigbee2mqtt/bridge/devices (retained list)
  MQ->>API: devices
  API->>API: z2m adapter: map exposes → DEVICE (protocol=zigbee) + ENDPOINTs
  API-->>App: new device found → assign rooms
  Note over API,ZD: From now on, commands go to zigbee2mqtt/{name}/set,<br/>and states arrive on zigbee2mqtt/{name}, normalised by the adapter.
```

---

## W9 — Power cut & boot

```mermaid
flowchart TD
  P["Mains returns"] --> B["ESP32-C6 boots<br/>relay GPIOs held OFF level before output enable"]
  B --> R{"Boot reason?"}
  R -- "power_on / brownout" --> N["Read NVS: last states + restore policy"]
  R -- "watchdog / sw_reset / ota" --> N
  N --> AP["Apply per channel:<br/>last → previous · off → OFF · on → ON<br/>staggered 150 ms per relay (inrush protection)"]
  AP --> IN["Sample all 6 inputs → baseline<br/>(no toggle on boot)"]
  IN --> W["Start Wi-Fi + MQTT"]
  W --> E["Publish event boot {reason} + state"]
```

Staggering avoids switching six loads (LED drivers, fan) at the same instant, which would stress the HLK supply and the house MCB.

---

## W10 — Customer journey (B2C & B2B)

```mermaid
flowchart LR
  L["Lead<br/>(referral, Instagram, builder, architect)"] --> Q1{"Segment"}
  Q1 -- "Home / villa (B2C)" --> S1["Site survey<br/>count switchboards, loads, Wi-Fi coverage"]
  Q1 -- "Builder / hotel / office (B2B)" --> S2["Requirement workshop<br/>no. of units, standard room template"]
  S1 & S2 --> QT["Quotation<br/>modules × boards + hub + install + AMC"]
  QT --> PO{"Approved?"}
  PO -- no --> F["Follow-up / revise"] --> QT
  PO -- yes --> PR["Prepare kit<br/>flash fw · pre-claim to org · label QR"]
  PR --> IJ["INSTALLATION_JOB scheduled"]
  IJ --> INS["On-site install (W11)"]
  INS --> HO["Handover<br/>owner account · app training · warranty card"]
  HO --> SUP["Support / AMC<br/>remote diagnostics · OTA · service visits"]
  SUP --> UP["Upsell<br/>sensors · curtains · energy · more rooms"]
  UP --> QT
```

---

## W11 — Installer on-site commissioning

```mermaid
flowchart TD
  A["Switch OFF MCB · verify with tester"] --> B["Open switchboard · photo 'before'"]
  B --> C["Wire SW6: L, N, switch legs → inputs, loads → relay outputs"]
  C --> D["Close board · MCB ON"]
  D --> E["Hub: plug in, connect to router (Ethernet preferred)"]
  E --> F["App: scan module QR → BLE provisioning → claim (W2)"]
  F --> G["Map channels → rooms / names / load types"]
  G --> H["Test every channel: app ON/OFF + wall switch ON/OFF"]
  H --> I{"All pass?"}
  I -- no --> J["Diagnose: identify LED, wiring, RSSI"] --> H
  I -- yes --> K["Create default scenes: All off, Good night"]
  K --> L["Checklist in INSTALLATION_JOB: photos, RSSI per module, load test"]
  L --> M["Invite owner (phone) → owner accepts → technician access downgraded"]
```

---

## W12 — Engineering pipeline (code → release)

```mermaid
flowchart LR
  subgraph DEV["Developer laptop"]
    C1["Code change<br/>firmware / backend / dashboard"] --> C2["Local tests<br/>unit · simulator · bench rig"]
  end
  C2 --> G["git push → GitHub (private)"]
  G --> CI{"GitHub Actions"}
  CI --> FW["Firmware job<br/>idf.py build · unit tests (Unity) · size check"]
  CI --> BE["Backend job<br/>lint · tsc · vitest · prisma migrate check"]
  CI --> FE["Dashboard job<br/>lint · build · Playwright smoke"]
  CI --> PR["Protocol job<br/>zod schemas ↔ protocol.h consistency"]
  FW & BE & FE & PR --> M{"PR review + green CI"}
  M -- merge to main --> TAG["Tag vX.Y.Z"]
  TAG --> REL["Release job"]
  REL --> R1["Firmware .bin signed (ECDSA key in GitHub secret / offline key)"]
  REL --> R2["Docker images: backend + dashboard → GHCR"]
  R1 & R2 --> BENCH["Bench rig soak test 24 h"]
  BENCH --> PILOT["Pilot site: 1 device → 24 h → all"]
  PILOT --> STABLE["Mark release stable"]
```

Branching: `main` (always deployable) + short-lived feature branches. Semver: firmware and hub are versioned independently; `packages/protocol` version bumps when the MQTT spec changes.

---

## W13 — Hardware pipeline (breadboard → certified product)

```mermaid
flowchart LR
  H1["Breadboard (low voltage)<br/>ESP32-C6 + relay module + buttons"] --> H2["Bench rig (mains)<br/>HLK supply, PC817 inputs, bulbs, MCB"]
  H2 --> H3["Perfboard prototype in ABS box<br/>first pilot client"]
  H3 --> H4["PCB v1 (KiCad → JLCPCB)<br/>creepage ≥ 6 mm mains↔LV, fuse, MOV"]
  H4 --> H5["Tests: thermal 6×8 A for 8 h · 10k switching cycles<br/>surge · Wi-Fi range · drop"]
  H5 --> H6["PCB v2 + V-0 enclosure<br/>(form factor fits behind Indian modular plates)"]
  H6 --> H7["Pre-compliance (EMI/safety) at a test lab"]
  H7 --> H8["Certification: BIS (if applicable) · WPC/ETA (radio) · Matter (optional)"]
  H8 --> H9["EMS manufacturing<br/>factory test jig · secure boot · per-device key injection"]
```

---

## W14 — Future cloud sync (design sketch)

```mermaid
sequenceDiagram
  autonumber
  actor U as User (away from home)
  participant MA as Mobile app
  participant CL as Cloud API
  participant CB as Cloud MQTT
  participant AG as Hub cloud agent
  participant API as Hub backend
  participant Dev as SW6

  AG->>CB: outbound TLS connection (no port forwarding)
  API->>AG: state changes (filtered by site.cloud_sync_enabled)
  AG->>CB: mirror state → cloud DB
  U->>MA: tap light ON
  MA->>CL: POST command (cloud auth)
  CL->>CB: cloud/{siteId}/cmd
  CB->>AG: cmd
  AG->>API: local command (same W3 flow)
  API->>Dev: cmd via local MQTT
  Dev-->>API: ack + state
  API-->>AG: ack + state
  AG-->>CB: ack + state
  CB-->>CL: ack
  CL-->>MA: ✓ ON
```
