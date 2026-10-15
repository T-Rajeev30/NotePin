"use strict";
// IMA ADPCM (4 bit) block codec used for the NotePin NPN2 stream when header bits == 4.
//
// Stream = sequence of units, each starting with a 4-byte header:
//   [0..1] i16 LE  predictor  (= the first sample of the block)      | or u16 run length for a silence unit
//   [2]    u8      step index (0..88)                                | ignored for a silence unit
//   [3]    u8      flag: 0 = audio block, 1 = silence run
// flag 0: 128 data bytes follow = 255 samples (low nibble first) + 1 pad nibble.  Block = 256 samples, 132 bytes.
// flag 1: no payload. The device skipped <run length> * 256 samples of silence (VAD). It doubles as a keep-alive.
const BLOCK_SAMPLES = 256;
const BLOCK_BYTES = 132;
const UNIT_HEADER = 4;

const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const INDEX_ADJ = [-1, -1, -1, -1, 2, 4, 6, 8];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Advances state {pred, idx} by one 4-bit code and returns the new predictor sample.
function step(state, nib) {
  const s = STEP[state.idx];
  let diff = s >> 3;
  if (nib & 1) diff += s >> 2;
  if (nib & 2) diff += s >> 1;
  if (nib & 4) diff += s;
  state.pred = clamp(
    nib & 8 ? state.pred - diff : state.pred + diff,
    -32768,
    32767,
  );
  state.idx = clamp(state.idx + INDEX_ADJ[nib & 7], 0, 88);
  return state.pred;
}

function encodeSample(state, sample) {
  let diff = sample - state.pred;
  let nib = 0;
  if (diff < 0) {
    nib = 8;
    diff = -diff;
  }
  let s = STEP[state.idx];
  if (diff >= s) {
    nib |= 4;
    diff -= s;
  }
  s >>= 1;
  if (diff >= s) {
    nib |= 2;
    diff -= s;
  }
  s >>= 1;
  if (diff >= s) nib |= 1;
  step(state, nib);
  return nib;
}

// samples: Int16Array/array of exactly 256. state.idx carries over between blocks.
function encodeBlock(samples, state) {
  const out = Buffer.alloc(BLOCK_BYTES);
  state.pred = samples[0];
  out.writeInt16LE(samples[0], 0);
  out[2] = state.idx;
  out[3] = 0;
  for (let i = 1; i < BLOCK_SAMPLES; i++) {
    const nib = encodeSample(state, samples[i]);
    const o = UNIT_HEADER + ((i - 1) >> 1);
    out[o] |= (i - 1) & 1 ? nib << 4 : nib;
  }
  return out;
}

const silenceRun = (blocks) => {
  const b = Buffer.alloc(UNIT_HEADER);
  b.writeUInt16LE(blocks, 0);
  b[3] = 1;
  return b;
};

function decodeBlock(buf) {
  const state = { pred: buf.readInt16LE(0), idx: buf[2] };
  if (state.idx > 88) throw new Error(`bad ADPCM step index ${state.idx}`);
  const pcm = Buffer.alloc(BLOCK_SAMPLES * 2);
  pcm.writeInt16LE(state.pred, 0);
  for (let i = 1; i < BLOCK_SAMPLES; i++) {
    const byte = buf[UNIT_HEADER + ((i - 1) >> 1)];
    pcm.writeInt16LE(step(state, (i - 1) & 1 ? byte >> 4 : byte & 15), i * 2);
  }
  return pcm;
}

// Incremental decoder. onPcm(Buffer s16le), onSkip(samples). Throws on a corrupt stream.
function createAdpcmDecoder({ onPcm, onSkip }) {
  let carry = Buffer.alloc(0);
  return {
    push(chunk) {
      let buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      let off = 0;
      for (;;) {
        if (buf.length - off < UNIT_HEADER) break;
        const flag = buf[off + 3];
        if (flag === 1) {
          onSkip(buf.readUInt16LE(off) * BLOCK_SAMPLES);
          off += UNIT_HEADER;
        } else if (flag === 0) {
          if (buf.length - off < BLOCK_BYTES) break;
          onPcm(decodeBlock(buf.subarray(off, off + BLOCK_BYTES)));
          off += BLOCK_BYTES;
        } else {
          throw new Error(`bad ADPCM unit flag ${flag}`);
        }
      }
      carry = Buffer.from(buf.subarray(off));
    },
  };
}

// Raw 16-bit PCM passthrough that keeps sample alignment across arbitrary TCP chunking.
function createPcmDecoder({ onPcm }) {
  let odd = null;
  return {
    push(chunk) {
      let buf = odd ? Buffer.concat([odd, chunk]) : chunk;
      odd = null;
      if (buf.length & 1) {
        odd = Buffer.from(buf.subarray(buf.length - 1));
        buf = buf.subarray(0, buf.length - 1);
      }
      if (buf.length) onPcm(buf);
    },
  };
}

const createDecoder = (bits, cb) =>
  bits === 4 ? createAdpcmDecoder(cb) : createPcmDecoder(cb);

module.exports = {
  BLOCK_SAMPLES,
  BLOCK_BYTES,
  UNIT_HEADER,
  STEP,
  INDEX_ADJ,
  encodeBlock,
  decodeBlock,
  silenceRun,
  createAdpcmDecoder,
  createPcmDecoder,
  createDecoder,
};
