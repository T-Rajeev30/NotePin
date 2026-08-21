"""
NotePin - Checkpoint 3b receiver.
Listens for the ESP32-S3, reads the stream header, and writes incoming
PCM to a WAV file until you press Ctrl+C.

Requires: Python 3 standard library only.
"""

import socket
import struct
import wave
import sys
import time

HOST = "0.0.0.0"
PORT = 5001
OUTPUT = "notepin_stream.wav"
EXPECTED_BYTES_PER_SEC = 16000 * 2  # 16kHz, 16-bit, mono

def show_local_ips():
    print("This PC's addresses (give the ESP32 the one on its network):")
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            print(f"  {info[4][0]}")
    except Exception as e:
        print(f"  (could not enumerate: {e})")
    print()

def main():
    show_local_ips()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((HOST, PORT))
    srv.listen(1)
    print(f"Listening on port {PORT} ... waiting for NotePin.")

    conn, addr = srv.accept()
    print(f"Connected from {addr[0]}")

    header = b""
    while len(header) < 12:
        part = conn.recv(12 - len(header))
        if not part:
            print("Connection closed before header arrived.")
            sys.exit(1)
        header += part

    magic = header[0:4]
    if magic != b"NPIN":
        print(f"Bad magic {magic!r} - is the device running wifi_stream.ino?")
        sys.exit(1)

    rate, bits, channels = struct.unpack("<IHH", header[4:12])
    print(f"Stream format: {rate} Hz, {bits}-bit, {channels}ch")

    wf = wave.open(OUTPUT, "wb")
    wf.setnchannels(channels)
    wf.setsampwidth(bits // 8)
    wf.setframerate(rate)

    total = 0
    start = time.time()
    last_report = start

    print("Recording. Speak into the mic. Press Ctrl+C to stop and save.\n")
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                print("\nDevice disconnected.")
                break
            wf.writeframes(data)
            total += len(data)

            now = time.time()
            if now - last_report >= 1.0:
                elapsed = now - start
                rate_bps = total / elapsed
                health = "OK" if rate_bps > EXPECTED_BYTES_PER_SEC * 0.95 else "BEHIND"
                print(f"\r{elapsed:6.1f}s  {total/1024:8.1f} KB  "
                      f"{rate_bps/1024:6.1f} KB/s  [{health}]", end="")
                last_report = now
    except KeyboardInterrupt:
        print("\n\nStopping.")
    finally:
        wf.close()
        conn.close()
        srv.close()
        secs = total / (rate * (bits // 8) * channels) if total else 0
        print(f"Saved {OUTPUT}  ({total/1024:.1f} KB, {secs:.1f}s of audio)")

if __name__ == "__main__":
    main()