# NotePin

A wearable AI-powered voice recording device: tap to record, transcribe and
summarize automatically, ask questions about what was recorded.

## Status

Phase: Prototype hardware bring-up — Checkpoint 1 PASSED

## Toolchain

Firmware is developed in **Arduino IDE** (not PlatformIO — original plan
was PlatformIO/VS Code, switched during bring-up for faster iteration).
Each sketch lives in its own folder under `firmware/esp32-s3/`, per
Arduino's folder-name-must-match-.ino-name requirement.

## Repository layout

- `firmware/esp32-s3/` — Arduino sketches
- `hardware/prototype/` — photos, measurements, wiring notes
- `hardware/pcb/` — reserved for future production PCB work (not used yet)
- `backend/`, `frontend/` — reserved for later phases
- `docs/` — architecture notes, checkpoint records, test results

## Hardware (prototype only — not final production BOM)

- Waveshare ESP32-S3 Mini dev board (ESP32-S3FH4R2, 4MB flash, native USB — confirmed)
- 2x INMP441 I2S MEMS microphones
- microSD card reader
- TP4056 USB-C LiPo charger
- NOVA 803450 3.7V 1500mAh LiPo battery
- TTP223 capacitive touch sensor
- XL3608 5V boost converter