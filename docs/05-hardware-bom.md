# 05 — Hardware Bill of Materials (prototype, India)

Prices are approximate (Oct 2026, INR, incl. GST) from Robu.in / Robocraze / Amazon.in / local markets (Lamington Road, SP Road, Lajpat Rai, Ritchie Street). Buy 1–2 spares of anything cheap that can burn.

## A. Phase 1 — must buy (bench demo)

| # | Part | Spec / what to search | Qty | ~₹ each | ~₹ total | Used for |
|---|---|---|---|---|---|---|
| 1 | ESP32-C6 DevKitC-1 | "ESP32-C6-DevKitC-1 N8" (8 MB flash) | 2 | 800 | 1,600 | Main MCU + 1 spare |
| 2 | 8-ch relay module | 5 V, optocoupled, **with JD-VCC jumper**, SRD-05VDC-SL-C | 1 | 450 | 450 | 6 relay outputs |
| 3 | HLK-10M05 | Hi-Link 230 VAC → 5 V 2 A isolated | 2 | 450 | 900 | Power supply (+1 spare) |
| 4 | PC817 optocoupler | DIP-4 | 10 | 8 | 80 | Wall-switch sensing |
| 5 | Resistor 100 kΩ ½ W | metal film | 20 | 2 | 40 | Input dropper (2 per channel) |
| 6 | Resistor 10 kΩ ¼ W | — | 10 | 1 | 10 | Input pull-ups |
| 7 | 1N4007 diode | — | 10 | 2 | 20 | PC817 reverse protection |
| 8 | Glass fuse holder + fuses | 5×20 mm, 1 A slow (F1) + 10 A (F2) | 2 + 6 | 30 | 220 | Supply + load protection |
| 9 | MOV 14D471K | 470 V varistor | 3 | 10 | 30 | Surge protection |
| 10 | Screw terminals | 5.08 mm, 2-pin & 3-pin | 15 | 8 | 120 | Mains wiring |
| 11 | Push buttons (tactile) | 12 mm | 6 | 5 | 30 | Low-voltage input testing (day 1) |
| 12 | Breadboard + jumper set | 830-point + M-M/M-F/F-F | 1 | 300 | 300 | Bench |
| 13 | Perfboard / zero PCB | 10×15 cm | 2 | 60 | 120 | Input board build |
| 14 | Wire | 1 mm² + 1.5 mm² (red, black, blue), 22 AWG hookup | — | — | 300 | Mains + LV |
| 15 | Test rig | 6 batten/bulb holders, 6× 9 W LED, 6 A MCB, 3-pin plug + 2 m cord, plywood board | 1 | — | 900 | Demo board for clients |
| 16 | ABS junction box | ~150×100×70 mm | 1 | 150 | 150 | Module enclosure |
| 17 | AHT20 | I²C temp/humidity | 1 | 150 | 150 | Automation demo |
| 18 | AM312 PIR | mini PIR, 3.3 V | 1 | 100 | 100 | Motion automation demo |
| | | | | **Subtotal** | **≈ ₹5,520** | |

## B. Tools (skip what you own)

| Part | ~₹ |
|---|---|
| Multimeter (continuity + AC V) | 600–1,200 |
| Soldering iron (adjustable temp, 60 W) + solder + flux | 500–800 |
| Wire stripper, screwdrivers, insulation tape, heat-shrink | 300 |
| Line tester (neon screwdriver) | 50 |
| **Subtotal** | **≈ ₹1,500–2,350** |

**Phase 1 total ≈ ₹7,000–8,000.**

## C. Phase 2 — after first demo / first client

| Part | ~₹ | Why |
|---|---|---|
| Sonoff ZBDongle-E (Zigbee 3.0 USB, EFR32MG21) | 2,200 | Zigbee coordinator for Zigbee2MQTT |
| PZEM-004T v3 + CT | 900 | Energy metering demo |
| ESP32-H2 DevKit | 600 | Battery Zigbee/Thread sensor prototype |
| Raspberry Pi 5 4 GB + PSU + case + 64 GB card (or used mini-PC) | 8,000 (or ~6,000 used) | Dedicated hub at the client site |
| 16 A relay (for AC / geyser) | 150 | Heavy-load channel variant |
| JLCPCB PCB v1 (5 boards) | 1,500–2,500 | First custom board |

## D. Do NOT buy (yet)

Oscilloscope, 3D printer, cloud services, Matter certification, multiple dev-kit variants.

## E. ESP32-C6 DevKitC-1 pin plan

| Function | GPIO | Notes |
|---|---|---|
| Relay IN1–IN6 | 18, 19, 20, 21, 22, 23 | No boot-time pulses; active-LOW |
| Switch input S1–S6 | 0, 1, 2, 3, 6, 7 | 0/1 free because the board has no 32 kHz crystal; 6/7 give up JTAG (we debug over USB) |
| I²C SDA / SCL | 10 / 11 | AHT20 |
| PIR | 4 | Strapping pin: OK because AM312 idles LOW at boot |
| Status LED | 8 | On-board WS2812 RGB (strapping pin, already used by the board) |
| BOOT / factory reset | 9 | On-board button; hold 10 s at runtime → factory reset |
| USB-Serial-JTAG | 12 / 13 | Flash + logs over USB-C; do not use |
| UART0 | 16 / 17 | Reserved for console |
| Avoid | 15 | Strapping pin |

> Before wiring, check this table against the silkscreen and the Espressif DevKitC-1 pin layout for your exact board revision.
