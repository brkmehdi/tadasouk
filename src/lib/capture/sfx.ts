// Camera shutter click, synthesized (no audio file): two short filtered noise bursts,
// the second softer, like a mechanical shutter opening and closing.

export function shutter(ctx: AudioContext | null) {
  if (!ctx || ctx.state === "closed") return;
  const now = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.05);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const click = (at: number, gain: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 0.8;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, at);
    amp.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
    src.connect(band).connect(amp).connect(ctx.destination);
    src.start(at);
  };
  click(now, 0.5);
  click(now + 0.075, 0.28);
}
