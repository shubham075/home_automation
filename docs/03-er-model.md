# 03 — Data Model (ER Diagrams)

Multi-tenant from day 1: **Organization (platform / partner / installer) → Site (home, villa, office, hotel…) → Floor → Room → Device → Endpoint (channel)**.

The same schema runs on the local hub (SQLite, usually one site) and in the future cloud (Postgres, all sites). Every site-scoped table carries `site_id`, so cloud sync is a plain filtered replication.

Conventions:
- Primary keys are **ULIDs** (`text`, sortable, generated offline on the hub; no collisions when syncing to the cloud).
- All tables have `created_at`, `updated_at` (omitted from diagrams for readability). Soft delete via `deleted_at` where noted.
- `json` = JSON column (SQLite `TEXT` with JSON functions, Postgres `JSONB`).
- Enum values are listed in §6.

---

## 1. Overview — all domains

```mermaid
erDiagram
  ORGANIZATION ||--o{ ORG_MEMBERSHIP : has
  USER ||--o{ ORG_MEMBERSHIP : joins
  ORGANIZATION ||--o{ SITE : manages
  USER ||--o{ SITE_MEMBERSHIP : "has access"
  SITE ||--o{ SITE_MEMBERSHIP : grants
  SITE ||--o{ FLOOR : contains
  FLOOR ||--o{ ROOM : contains
  SITE ||--o{ HUB : runs
  HUB ||--o{ DEVICE : controls
  DEVICE_MODEL ||--o{ DEVICE : "instance of"
  DEVICE ||--|{ ENDPOINT : exposes
  ROOM ||--o{ ENDPOINT : "placed in"
  ENDPOINT ||--|| ENDPOINT_STATE : "current"
  ENDPOINT ||--o{ TELEMETRY : records
  ENDPOINT ||--o{ COMMAND : receives
  SITE ||--o{ SCENE : defines
  SCENE ||--o{ SCENE_ACTION : "consists of"
  SITE ||--o{ AUTOMATION : defines
  AUTOMATION ||--o{ AUTOMATION_RUN : logs
  DEVICE_MODEL ||--o{ FIRMWARE_RELEASE : has
  FIRMWARE_RELEASE ||--o{ OTA_JOB : "deployed by"
  DEVICE ||--o{ OTA_JOB : receives
  SITE ||--o{ AUDIT_LOG : records
  SITE ||--o{ INSTALLATION_JOB : "serviced by"
```

---

## 2. Tenancy & identity

```mermaid
erDiagram
  ORGANIZATION {
    text id PK
    text name
    text type "platform | partner | installer"
    text parent_org_id FK "partner under platform"
    text gstin "nullable"
    text phone
    text email
    text city
    text state
    text status "active | suspended"
  }
  USER {
    text id PK
    text name
    text phone UK "E.164, primary login in India"
    text email UK "nullable"
    text password_hash "argon2id, nullable for passkey-only users"
    bool phone_verified
    text locale "en | hi | ..."
    text status "active | disabled"
    timestamp last_login_at
  }
  ORG_MEMBERSHIP {
    text id PK
    text org_id FK
    text user_id FK
    text role "org_owner | org_admin | technician | support"
  }
  SITE {
    text id PK
    text org_id FK "managing partner/installer"
    text name
    text type "apartment | independent_house | villa | office | hotel | retail | other"
    text address_line
    text city
    text state
    text pincode
    real lat
    real lng
    text timezone "Asia/Kolkata"
    text status "draft | installing | active | suspended"
    bool cloud_sync_enabled
  }
  SITE_MEMBERSHIP {
    text id PK
    text site_id FK
    text user_id FK
    text role "owner | admin | member | guest"
    timestamp valid_from "guest access window"
    timestamp valid_until
  }
  INVITATION {
    text id PK
    text site_id FK
    text invited_by FK
    text phone_or_email
    text role
    text token_hash
    timestamp expires_at
    timestamp accepted_at
  }
  REFRESH_TOKEN {
    text id PK
    text user_id FK
    text family_id "one per login; reuse revokes the family"
    text replaced_by_id "next token after rotation"
    text token_hash
    text client_info "browser / app + device"
    timestamp expires_at
    timestamp revoked_at
  }
  WEBAUTHN_CREDENTIAL {
    text id PK "credential id (base64url)"
    text user_id FK
    text public_key
    int sign_count
    text transports "internal | hybrid | usb"
    text label "Pixel 8, Windows Hello"
    timestamp last_used_at
  }
  PUSH_TOKEN {
    text id PK
    text user_id FK
    text platform "android | ios | web"
    text token
    timestamp updated_at
  }

  ORGANIZATION ||--o{ ORGANIZATION : "parent of"
  USER ||--o{ WEBAUTHN_CREDENTIAL : "signs in with"
  USER ||--o{ PUSH_TOKEN : "receives on"
  ORGANIZATION ||--o{ ORG_MEMBERSHIP : has
  USER ||--o{ ORG_MEMBERSHIP : "belongs to"
  ORGANIZATION ||--o{ SITE : manages
  SITE ||--o{ SITE_MEMBERSHIP : grants
  USER ||--o{ SITE_MEMBERSHIP : holds
  SITE ||--o{ INVITATION : issues
  USER ||--o{ INVITATION : sends
  USER ||--o{ REFRESH_TOKEN : owns
```

**Access rule:** a user can act on a site if they have a `SITE_MEMBERSHIP` on it **or** an `ORG_MEMBERSHIP` (technician+) on the organization that manages it. Hotel/office deployments reuse the same tables: a hotel = site, each guest room = room, staff = members, hotel guests = time-boxed `guest` memberships.

---

## 3. Topology & devices

```mermaid
erDiagram
  SITE {
    text id PK
    text name
  }
  FLOOR {
    text id PK
    text site_id FK
    text name "Ground, First, Terrace"
    int level
    int sort_order
  }
  ROOM {
    text id PK
    text site_id FK
    text floor_id FK
    text name "Living, Master Bedroom, Cabin 3"
    text type "living | bedroom | kitchen | bathroom | office | lobby | outdoor | other"
    text icon
    int sort_order
  }
  HUB {
    text id PK
    text site_id FK
    text serial UK
    text hostname "sw6hub-xxxx.local"
    text sw_version
    text status "online | offline"
    timestamp last_seen_at
    text cloud_agent_id "nullable, future"
  }
  DEVICE_MODEL {
    text id PK
    text sku UK "SW6-R10, SENS-PIR1, ZB-PLUG"
    text name
    text category "switch | dimmer | fan | plug | sensor | ir | curtain | lock"
    text protocol "wifi | zigbee | thread | matter"
    int channel_count
    json capabilities "ota, identify, power_metering..."
    text manufacturer "own | third_party"
  }
  DEVICE {
    text id PK "sw6-a1b2c3d4e5f6"
    text site_id FK
    text hub_id FK
    text model_id FK
    text name "Living room board"
    text mac UK "nullable for zigbee"
    text ieee_addr UK "zigbee only"
    text fw_version
    text hw_revision
    text status "unclaimed | provisioning | online | offline | error | decommissioned"
    int config_rev_desired
    int config_rev_applied
    text ip_address
    int rssi
    timestamp last_seen_at
    timestamp claimed_at
    text claimed_by FK "user id"
    timestamp deleted_at
  }
  DEVICE_CREDENTIAL {
    text id PK
    text device_id FK
    text type "mqtt_password | x509"
    text secret_hash "or cert fingerprint"
    timestamp issued_at
    timestamp revoked_at
  }
  ENDPOINT {
    text id PK
    text device_id FK
    text room_id FK "each channel can sit in a different room"
    int channel "1..6"
    text kind "relay | dimmer | fan_speed | input | temperature | humidity | motion | contact | power"
    text name "Ceiling light, Fan, Socket"
    text load_type "light | fan | socket | ac | geyser | pump | other"
    int rated_watts
    text restore_policy "last | off | on"
    text input_mode "toggle | follow | disabled"
    bool favorite
    bool hidden
  }
  ENDPOINT_STATE {
    text endpoint_id PK, FK
    json value "{on:true} | {level:60} | {c:27.4}"
    text source "physical | app | automation | scene | schedule | voice | restore"
    text changed_by FK "user id, nullable"
    timestamp changed_at
    int device_seq
  }

  SITE ||--o{ FLOOR : contains
  FLOOR ||--o{ ROOM : contains
  SITE ||--o{ ROOM : "owns (denormalised)"
  SITE ||--o{ HUB : runs
  HUB ||--o{ DEVICE : controls
  SITE ||--o{ DEVICE : "owns (denormalised)"
  DEVICE_MODEL ||--o{ DEVICE : "instance of"
  DEVICE ||--o{ DEVICE_CREDENTIAL : authenticates
  DEVICE ||--|{ ENDPOINT : exposes
  ROOM ||--o{ ENDPOINT : groups
  ENDPOINT ||--|| ENDPOINT_STATE : has
```

**Why `ENDPOINT` matters:** a single SW6 board behind a switchboard often drives loads in two rooms (e.g. bedroom light + corridor light). Users think in *loads*, not *boards*, so the UI lists endpoints by room; the board is an installer-level detail.

---

## 4. Control, history & automation

```mermaid
erDiagram
  ENDPOINT {
    text id PK
    text device_id FK
  }
  COMMAND {
    text id PK "= cid sent over MQTT"
    text site_id FK
    text endpoint_id FK
    text requested_by FK "user id, nullable for automations"
    text source "app | automation | scene | schedule | voice | api"
    text automation_run_id FK "nullable"
    json payload "{op:set, on:true}"
    text status "pending | sent | acked | failed | timeout"
    int attempts
    text error_code
    timestamp created_at
    timestamp sent_at
    timestamp acked_at
  }
  TELEMETRY {
    text endpoint_id FK
    timestamp ts
    text metric "on | power_w | energy_wh | temp_c | rssi"
    real value
  }
  SCENE {
    text id PK
    text site_id FK
    text room_id FK "nullable = whole site"
    text name "Good night, Movie, All off"
    text icon
    int sort_order
  }
  SCENE_ACTION {
    text id PK
    text scene_id FK
    text endpoint_id FK
    json target "{on:false} | {level:30}"
    int delay_ms
  }
  AUTOMATION {
    text id PK
    text site_id FK
    text name
    bool enabled
    json trigger "see trigger types"
    json conditions "time window, endpoint state, presence"
    json actions "set_endpoint | run_scene | notify | delay"
    int cooldown_sec
    text created_by FK
    timestamp last_run_at
  }
  AUTOMATION_RUN {
    text id PK
    text automation_id FK
    timestamp started_at
    text trigger_snapshot
    text result "success | partial | failed | skipped_condition | skipped_cooldown"
    text detail
  }
  NOTIFICATION {
    text id PK
    text site_id FK
    text user_id FK
    text type "device_offline | automation | security | ota | system"
    text title
    text body
    timestamp read_at
  }

  ENDPOINT ||--o{ COMMAND : receives
  ENDPOINT ||--o{ TELEMETRY : records
  SCENE ||--|{ SCENE_ACTION : "consists of"
  ENDPOINT ||--o{ SCENE_ACTION : targets
  AUTOMATION ||--o{ AUTOMATION_RUN : logs
  AUTOMATION_RUN ||--o{ COMMAND : issues
```

**Trigger types (`AUTOMATION.trigger.type`):**

| type | config example |
|---|---|
| `endpoint_state` | `{ "endpoint_id": "…", "to": { "on": true } }` |
| `motion` | `{ "endpoint_id": "pir…", "detected": true }` |
| `time` | `{ "cron": "0 19 * * *" }` |
| `sun` | `{ "event": "sunset", "offset_min": -15 }` (uses site lat/lng) |
| `threshold` | `{ "endpoint_id": "temp…", "metric": "temp_c", "above": 30 }` |
| `device_status` | `{ "device_id": "…", "to": "offline", "for_sec": 300 }` |

`TELEMETRY` is append-only and high-volume: SQLite table with `(endpoint_id, ts)` index and 90-day retention on the hub; TimescaleDB hypertable in the cloud phase.

---

## 5. Operations: firmware, audit, field service

```mermaid
erDiagram
  DEVICE_MODEL {
    text id PK
    text sku
  }
  FIRMWARE_RELEASE {
    text id PK
    text model_id FK
    text version "semver 0.2.0"
    text channel "dev | beta | stable"
    text file_path
    int size_bytes
    text sha256
    text signature "ECDSA P-256"
    text min_hw_revision
    text release_notes
    timestamp published_at
  }
  OTA_JOB {
    text id PK
    text device_id FK
    text release_id FK
    text requested_by FK
    text status "queued | downloading | verifying | applying | success | failed | rolled_back"
    int progress_pct
    text from_version
    text error
    timestamp started_at
    timestamp finished_at
  }
  DEVICE {
    text id PK
    text fw_version
  }
  AUDIT_LOG {
    text id PK
    text site_id FK
    text actor_type "user | device | automation | system"
    text actor_id
    text action "device.claim | endpoint.set | scene.run | member.invite | ota.start ..."
    text target_type
    text target_id
    json data
    text ip
    timestamp ts
  }
  INSTALLATION_JOB {
    text id PK
    text site_id FK
    text org_id FK
    text technician_id FK "user"
    text type "survey | install | service | uninstall"
    text status "scheduled | in_progress | completed | cancelled"
    timestamp scheduled_at
    timestamp completed_at
    json checklist "wiring photos, load test, handover signed"
    text notes
  }
  SITE {
    text id PK
  }

  DEVICE_MODEL ||--o{ FIRMWARE_RELEASE : has
  FIRMWARE_RELEASE ||--o{ OTA_JOB : "deployed by"
  DEVICE ||--o{ OTA_JOB : receives
  SITE ||--o{ AUDIT_LOG : records
  SITE ||--o{ INSTALLATION_JOB : "serviced by"
```

---

## 6. Enums (single source of truth)

| Enum | Values |
|---|---|
| `org_type` | platform, partner, installer |
| `org_role` | org_owner, org_admin, technician, support |
| `site_type` | apartment, independent_house, villa, office, hotel, retail, other |
| `site_role` | owner, admin, member, guest |
| `device_status` | unclaimed, provisioning, online, offline, error, decommissioned |
| `protocol` | wifi, zigbee, thread, matter |
| `endpoint_kind` | relay, dimmer, fan_speed, input, temperature, humidity, motion, contact, power |
| `load_type` | light, fan, socket, ac, geyser, pump, other |
| `change_source` | physical, app, automation, scene, schedule, voice, restore, api |
| `command_status` | pending, sent, acked, failed, timeout |
| `ota_status` | queued, downloading, verifying, applying, success, failed, rolled_back |

## 7. Role → permission matrix

| Action | guest | member | admin | owner | technician (org) | org_admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Control endpoints | ✓ (allowed rooms) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Run scenes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create scenes / automations | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rename rooms / endpoints | | | ✓ | ✓ | ✓ | ✓ |
| Invite / remove members | | | ✓ | ✓ | | ✓ |
| Claim / remove devices | | | | ✓ | ✓ | ✓ |
| OTA updates | | | | ✓ | ✓ | ✓ |
| Transfer ownership / delete site | | | | ✓ | | ✓ |

## 8. Key indexes

| Table | Index |
|---|---|
| `site_membership` | unique (`site_id`, `user_id`) |
| `device` | unique (`mac`), unique (`ieee_addr`), (`site_id`, `status`) |
| `endpoint` | unique (`device_id`, `channel`, `kind`), (`room_id`) |
| `command` | (`endpoint_id`, `created_at` desc), (`status`) where status in (pending, sent) |
| `telemetry` | (`endpoint_id`, `ts`) |
| `audit_log` | (`site_id`, `ts` desc) |
