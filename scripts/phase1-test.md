# Phase 1 Manual Test

## 1. Flash

```bash
cd firmware
pio run -t erase
pio run -t upload
pio device monitor
```

## 2. Fresh boot

Expected:

```text
No saved Wi-Fi credentials.
NOTE PIN SETUP MODE
SSID: NotePin-XXXX
URL: http://192.168.4.1/
```

## 3. Phone

Connect phone to:

```text
NotePin-XXXX
```

Open:

```text
http://192.168.4.1/
```

## 4. Provision

Select a known 2.4 GHz network.

Enter password.

Wait for Wi-Fi and internet checks.

## 5. Reboot

Power-cycle the NotePin.

Expected:

```text
Saved Wi-Fi credentials found.
Wi-Fi connected.
```

## 6. Reset

Hold TTP223 for 8 seconds.

Expected:

```text
Long touch detected. Clearing Wi-Fi credentials.
NOTE PIN SETUP MODE
```
