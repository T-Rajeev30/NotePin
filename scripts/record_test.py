"""
NotePin - Checkpoint 2 listen-back test.
Triggers the ESP32-S3 to record 5 seconds of audio over serial and
saves it as a playable WAV file.

Requires: pip install pyserial
"""

import serial
import time
import sys

PORT = "COM8"          # <-- CHANGE THIS to your actual COM port
BAUD = 115200
SAMPLE_RATE = 16000
RECORD_SECONDS = 5
OUTPUT_FILE = "notepin_test.wav"


def main():
    print(f"Opening {PORT}...")
    ser = serial.Serial(PORT, BAUD, timeout=10)
    time.sleep(2)  # let the port settle
    ser.reset_input_buffer()

    print("Sending record trigger...")
    ser.write(b'R')

    # Wait for the BEGIN marker
    while True:
        line = ser.readline().decode(errors="ignore").strip()
        if line:
            print(f"< {line}")
        if line == "BEGIN":
            break
        if not line:
            print("Timed out waiting for device. Check COM port and that")
            print("Arduino IDE's Serial Monitor is closed.")
            sys.exit(1)

    total_bytes = SAMPLE_RATE * RECORD_SECONDS * 2
    print(f"Reading {total_bytes} bytes of audio (~{RECORD_SECONDS}s)...")
    audio_data = ser.read(total_bytes)
    print(f"Got {len(audio_data)} bytes")

    import wave
    with wave.open(OUTPUT_FILE, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio_data)

    print(f"Saved: {OUTPUT_FILE}")
    ser.close()


if __name__ == "__main__":
    main()