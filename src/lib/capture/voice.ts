// Microphone -> short speech chunks. An energy-based voice activity detector cuts the
// stream at pauses; each chunk becomes a 16 kHz mono 16-bit WAV, the format the
// transcription endpoint accepts.

const RATE = 16_000;
const FRAME = 320; // 20 ms
const PRE_ROLL_FRAMES = 12; // 240 ms kept from before speech starts
const START_FRAMES = 4; // 80 ms of voice opens a chunk
const END_SILENCE_MS = 500; // a pause this long closes it
const MAX_CHUNK_MS = 7_000;
const MIN_SPEECH_MS = 300;

export type VoiceEvents = {
  onSpeechStart: (at: number) => void;
  onChunk: (wav: ArrayBuffer, info: { startedAt: number; endedAt: number }) => void;
  onLevel?: (rms: number, speaking: boolean) => void;
};

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("tap", Tap);
`;

// `ctx` must be created inside the tap on the record button: iOS keeps an AudioContext made
// later silent. It runs at the device rate (often 48 kHz); chunks are downsampled to 16 kHz here.
export async function startVoice(ctx: AudioContext, stream: MediaStream, ev: VoiceEvents) {
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const tap = new AudioWorkletNode(ctx, "tap");
  source.connect(tap);
  // Some browsers only run a node that reaches the speakers; a muted gain keeps it silent.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  tap.connect(mute).connect(ctx.destination);

  // Box-filter downsampling to 16 kHz: average the input samples that fall in each output slot.
  const ratio = ctx.sampleRate / RATE;
  let acc = 0;
  let accN = 0;
  let phase = 0;
  const downsample = (input: Float32Array) => {
    if (ratio === 1) return input;
    const out = new Float32Array(Math.ceil(input.length / ratio) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      acc += input[i];
      accN++;
      phase += 1;
      if (phase >= ratio) {
        out[n++] = acc / accN;
        acc = 0;
        accN = 0;
        phase -= ratio;
      }
    }
    return out.subarray(0, n);
  };

  let pending = new Float32Array(0);
  const preRoll: Float32Array[] = [];
  let chunk: Float32Array[] = [];
  let speaking = false;
  let voicedRun = 0;
  let silentMs = 0;
  let startedAt = 0;
  let floor = 0.005;

  const finish = (now: number) => {
    const ms = (chunk.length * FRAME * 1000) / RATE;
    if (ms - silentMs >= MIN_SPEECH_MS) ev.onChunk(toWav(chunk), { startedAt, endedAt: now });
    chunk = [];
    speaking = false;
    silentMs = 0;
  };

  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const input = downsample(e.data);
    const merged = new Float32Array(pending.length + input.length);
    merged.set(pending);
    merged.set(input, pending.length);
    let offset = 0;
    while (merged.length - offset >= FRAME) {
      const frame = merged.slice(offset, offset + FRAME);
      offset += FRAME;
      let sum = 0;
      for (let i = 0; i < FRAME; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / FRAME);
      const threshold = Math.max(0.012, floor * 3);
      const voiced = rms > threshold;
      const now = performance.now();

      if (!speaking) {
        floor = voiced ? floor : floor * 0.98 + rms * 0.02;
        preRoll.push(frame);
        if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift();
        voicedRun = voiced ? voicedRun + 1 : 0;
        if (voicedRun >= START_FRAMES) {
          speaking = true;
          startedAt = now - (preRoll.length * FRAME * 1000) / RATE;
          chunk = preRoll.splice(0);
          ev.onSpeechStart(startedAt);
        }
      } else {
        chunk.push(frame);
        silentMs = voiced ? 0 : silentMs + 20;
        const ms = (chunk.length * FRAME * 1000) / RATE;
        if (silentMs >= END_SILENCE_MS || ms >= MAX_CHUNK_MS) finish(now);
      }
      ev.onLevel?.(rms, speaking);
    }
    pending = merged.slice(offset);
  };

  return {
    async stop() {
      if (speaking) finish(performance.now());
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      mute.disconnect();
      await ctx.close().catch(() => {});
    },
  };
}

function toWav(frames: Float32Array[]) {
  const samples = frames.length * FRAME;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, f[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return buf;
}
