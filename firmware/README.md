# NotePin Firmware

## Phase 1

Phase 1 implements:

- ESP32-S3 boot
- device identity
- first-boot detection
- Wi-Fi provisioning AP
- captive portal
- local onboarding UI
- Wi-Fi scanning
- credential storage
- Wi-Fi connection
- connectivity checks
- automatic reconnect
- long-touch factory/setup reset

## Install

```bash
pio run
pio run -t upload
```

The UI is embedded directly in firmware for this phase, so `uploadfs` is not required.

## Serial

```bash
pio device monitor
```

Expected first boot:

```text
NOTE PIN
Firmware: 0.1.0-phase1
Device ID: NP-XXXXXXXX
No saved Wi-Fi credentials.
NOTE PIN SETUP MODE
SSID: NotePin-XXXX
URL: http://192.168.4.1/
```

## Long touch

Hold TTP223 for 8 seconds.

The device erases the stored Wi-Fi credentials and returns to provisioning mode.

## Phase 1 hardware test matrix

| Test | Expected |
|---|---|
| Cold boot | Device starts |
| No credentials | AP starts |
| Phone joins AP | Phone receives local IP |
| Android captive probe | Redirects to setup |
| iOS captive probe | Redirects to setup |
| Windows captive probe | Redirects to setup |
| Manual `192.168.4.1` | Setup loads |
| Wi-Fi scan | Nearby SSIDs appear |
| Correct password | STA connects |
| Wrong password | Connection fails |
| Credentials survive reboot | Yes |
| Long touch | Credentials cleared |
| Second boot | Automatic reconnect |

## Note

The current server check is intentionally optional. Until a VPA health endpoint exists, the UI can still complete onboarding after Wi-Fi + internet are verified.

Do not treat `setInsecure()` in the optional HTTPS health probe as production security. Phase 2 replaces this with proper certificate validation and device authentication.
