#!/usr/bin/env python3
"""
Transcribes a WAV file using faster-whisper (a fast, quantized re-implementation
of OpenAI's Whisper). Invoked by tcpIngest.js as a subprocess, same pattern as
the DeepFilterNet denoise step.

Usage: python transcribe.py <input.wav> <output.json>

Writes a JSON file:
{
  "text": "full transcript as one string",
  "segments": [{"start": 0.0, "end": 3.2, "text": "..."}, ...],
  "language": "en",
  "languageProbability": 0.98,
  "durationSec": 10.91,
  "transcribeTimeSec": 4.2
}

Model size and device are configurable via environment variables so they can
be tuned without editing this file:
  WHISPER_MODEL_SIZE  - tiny | base | small | medium | large-v3 (default: small)
  WHISPER_DEVICE      - cpu | cuda (default: cpu)
  WHISPER_COMPUTE_TYPE - int8 | float16 | float32 (default: int8 - fastest on CPU)

The FIRST run downloads and caches the chosen model from Hugging Face - this
needs internet access and will be slow (the "small" model is roughly 500MB).
Every run after that reuses the cached model and works fully offline.
"""
import sys
import os
import json
import time


def main():
    if len(sys.argv) != 3:
        print("Usage: python transcribe.py <input.wav> <output.json>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    if not os.path.exists(input_path):
        print(f"Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    model_size = os.environ.get("WHISPER_MODEL_SIZE", "small")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

    from faster_whisper import WhisperModel

    print(f"Loading model '{model_size}' (device={device}, compute_type={compute_type})...", file=sys.stderr)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    start = time.time()
    segments, info = model.transcribe(input_path, beam_size=5)

    segment_list = []
    full_text_parts = []
    for seg in segments:
        text = seg.text.strip()
        segment_list.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": text,
        })
        full_text_parts.append(text)

    elapsed = time.time() - start

    result = {
        "text": " ".join(full_text_parts).strip(),
        "segments": segment_list,
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "durationSec": round(info.duration, 2),
        "transcribeTimeSec": round(elapsed, 2),
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"OK duration={result['durationSec']}s transcribe_time={elapsed:.2f}s chars={len(result['text'])}")


if __name__ == "__main__":
    main()