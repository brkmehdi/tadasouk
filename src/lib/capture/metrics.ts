// Phase 0 latency measurements, kept per capture session and shown in the debug panel.
//   highlight: first outline drawn after the camera starts, and detector time per frame
//   capture:   capture trigger -> product card shows the SAM cutout
//   command:   end of speech -> UI updated (split into transcription and agent time)

export type Sample = { at: number; ms: number; parts?: Record<string, number> };

export type Metrics = {
  firstHighlightMs: number | null;
  detectMs: number[];
  capture: Sample[];
  command: Sample[];
};

export function emptyMetrics(): Metrics {
  return { firstHighlightMs: null, detectMs: [], capture: [], command: [] };
}

export function pct(values: number[], p: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export function report(m: Metrics) {
  const cap = m.capture.map((s) => s.ms);
  const cmd = m.command.map((s) => s.ms);
  const part = (list: Sample[], key: string) => list.map((s) => s.parts?.[key]).filter((v): v is number => v != null);
  return {
    firstHighlightMs: m.firstHighlightMs,
    detectP50: pct(m.detectMs, 50),
    detectP95: pct(m.detectMs, 95),
    captureN: cap.length,
    captureP50: pct(cap, 50),
    captureP95: pct(cap, 95),
    samP50: pct(part(m.capture, "sam"), 50),
    commandN: cmd.length,
    commandP50: pct(cmd, 50),
    commandP95: pct(cmd, 95),
    asrP50: pct(part(m.command, "asr"), 50),
    agentP50: pct(part(m.command, "agent"), 50),
  };
}
