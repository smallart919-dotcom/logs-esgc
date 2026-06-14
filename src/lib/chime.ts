/**
 * Silky proximity chime — descending C major triad (G5 → E5 → C5) with
 * a sine+triangle blend, slow vibrato, low-pass warmth and a single
 * delay-echo for a reverb-style tail. Pleasant enough for all-day use.
 *
 * Module-level shared AudioContext so the chime works across route changes.
 * Browsers require a prior user gesture to resume — any click on the page
 * after page load will unlock playback.
 */
let _ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (_ctx) return _ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  _ctx = new AC();
  return _ctx;
}

/** Try to unlock the AudioContext on the first user gesture (idempotent). */
export function primeChime() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const ctx = ensureCtx();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, unlock, { once: false, passive: true }),
  );
}

export function playChime(volume = 0.9) {
  try {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const vol = Math.max(0, Math.min(1, volume));

    const master = ctx.createGain();
    master.gain.value = vol;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2000; lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(lp); lp.connect(comp); comp.connect(ctx.destination);

    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.22;
    const echoGain = ctx.createGain();
    echoGain.gain.value = 0.12;
    delay.connect(echoGain); echoGain.connect(lp);

    const tone = (freq: number, start: number, dur: number, peak: number) => {
      const osc1 = ctx.createOscillator();
      osc1.type = "sine"; osc1.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = "triangle"; osc2.frequency.value = freq * 2;
      const lfo = ctx.createOscillator();
      lfo.type = "sine"; lfo.frequency.value = 5.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 3;
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);
      lfoGain.connect(osc2.frequency);
      const g = ctx.createGain();
      const h = ctx.createGain();
      h.gain.value = 0.07;
      g.gain.setValueAtTime(0.0001, now + start);
      g.gain.exponentialRampToValueAtTime(peak, now + start + 0.12);
      g.gain.setValueAtTime(peak, now + start + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc1.connect(g); osc2.connect(h); h.connect(g);
      g.connect(master); g.connect(delay);
      const startT = now + start;
      const stopT = now + start + dur + 0.15;
      lfo.start(startT); lfo.stop(stopT);
      osc1.start(startT); osc1.stop(stopT);
      osc2.start(startT); osc2.stop(stopT);
    };

    tone(783.99, 0.00, 0.55, 0.35);
    tone(659.25, 0.18, 0.65, 0.32);
    tone(523.25, 0.36, 0.95, 0.30);
  } catch {
    /* noop */
  }
}
