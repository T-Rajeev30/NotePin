# NotePin

**NotePin** is an upstream-first wearable audio capture device.

> Hardware captures reality. VPA turns reality into knowledge.

## Current milestone

### Phase 1 — First Boot + Phone Onboarding

This phase is complete when a fresh NotePin can:

1. Boot without credentials.
2. Create a temporary Wi-Fi access point.
3. Open a captive/local setup experience from a phone.
4. Show a polished local onboarding dashboard.
5. Show an animated NotePin device model.
6. Explain the setup steps.
7. Scan nearby Wi-Fi networks.
8. Accept Wi-Fi credentials.
9. Test the Wi-Fi connection.
10. Persist credentials in NVS.
11. Reboot into normal STA mode.
12. Reconnect automatically on later boots.
13. Allow an 8-second touch hold to re-enter setup.
14. Never require QR onboarding.
15. Never require Bluetooth onboarding.

## Product architecture

```text
                         ┌─────────────────────────┐
                         │         NOTE PIN        │
                         │                         │
                         │ ESP32-S3                │
                         │   ├── INMP441           │
                         │   ├── TTP223            │
                         │   ├── NeoPixel          │
                         │   └── Wi-Fi             │
                         └───────────┬─────────────┘
                                     │
                              AUDIO / TELEMETRY
                                     │
                                     ▼
                         ┌─────────────────────────┐
                         │       VPA SERVER        │
                         │                         │
                         │ Deepgram / LLM / RAG    │
                         │ MCP / Memory / Workers  │
                         └─────────────────────────┘
```

V1 is intentionally **upstream-only**. The wearable does not receive AI commands, TTS, or application actions.

## Repository

```text
NotePin/
├── firmware/
│   ├── include/
│   ├── src/
│   ├── data/
│   ├── test/
│   ├── platformio.ini
│   └── README.md
├── backend/
├── web/
├── hardware/
├── docs/
├── scripts/
├── .gitignore
└── README.md
```

## Hardware currently assumed

| Function | Part | Pin |
|---|---|---:|
| MCU | ESP32-S3 | — |
| Microphone | INMP441 | BCLK GPIO 4 |
| Microphone | INMP441 | WS GPIO 5 |
| Microphone | INMP441 | DATA GPIO 6 |
| Touch | TTP223 | GPIO 7 |
| Status LED | NeoPixel hook | GPIO 21 |

**Important:** verify the final PCB pin map before production flashing.

## Setup mode

A fresh device creates:

```text
SSID: NotePin-XXXX
Gateway: 192.168.4.1
```

The device runs a local web server and DNS wildcard redirect.

Common captive portal probes are redirected to the setup page.

## Build

Install:

- VS Code
- PlatformIO extension
- ESP32 platform

Then:

```bash
cd firmware
pio run
pio run -t upload
pio run -t uploadfs
pio device monitor
```

Or from the repository root:

```bash
cd firmware
pio run
```

## First test

1. Flash firmware.
2. Open serial monitor at 115200.
3. Power-cycle NotePin.
4. Confirm `NotePin-XXXX` appears.
5. Connect the phone to it.
6. Wait for the captive portal.
7. If it does not open automatically, browse to:

```text
http://192.168.4.1/
```

8. Scan Wi-Fi.
9. Select a network.
10. Enter its password.
11. Connect.
12. Wait for the final "NotePin is ready" screen.
13. Power-cycle the device.
14. Confirm it reconnects automatically.

## Re-enter setup

Touch and hold the TTP223 for **8 seconds**.

This clears saved Wi-Fi credentials and returns the device to provisioning.

## What is deliberately NOT in Phase 1

- Deepgram
- LLM
- RAG
- MCP
- audio streaming
- speaker/TTS
- NAND offline queue
- OTA
- production authentication

Those belong to later phases.

## Phase 1 exit criterion

```text
Fresh NotePin
    ↓
AP
    ↓
Phone
    ↓
Local onboarding
    ↓
Wi-Fi
    ↓
Persistent credentials
    ↓
Normal boot
    ↓
Automatic reconnect
```

No cloud dependency is required for the onboarding UI.
