/**
 * Procedural Web Audio. Everything is synthesised — no asset downloads.
 *
 * The context is created lazily on the first user gesture, all one-shots are
 * budget-limited, and every node is disconnected when its envelope finishes so
 * long sessions do not leak graph nodes.
 */

const MAX_CONCURRENT_ONESHOTS = 10;

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private liveOneShots = 0;

  private engine: {
    osc: OscillatorNode;
    sub: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;

  private siren: {
    osc: OscillatorNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
    gain: GainNode;
  } | null = null;

  private ambient: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  private volume = 0.7;
  private muted = false;
  private suspended = false;

  /** Must be called from a user gesture (Play button click). */
  init(): boolean {
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.master !== null;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }

  private applyMaster() {
    if (!this.ctx || !this.master) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /** Suspend on pause / tab hidden; resume on return. */
  setSuspended(s: boolean) {
    this.suspended = s;
    if (!this.ctx) return;
    if (s) {
      this.stopEngine();
      this.stopSiren();
      void this.ctx.suspend().catch(() => {});
    } else {
      void this.ctx.resume().catch(() => {});
    }
  }

  // ---- Engine ------------------------------------------------------------

  startEngine() {
    if (!this.ctx || !this.master || this.engine || this.suspended) return;
    const ctx = this.ctx;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 3;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;

    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = 30;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master);

    osc.start();
    sub.start();
    gain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.15);

    this.engine = { osc, sub, gain, filter };
  }

  /** speed01: normalised speed 0..1. */
  updateEngine(speed01: number, throttle: number) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed01));
    const base = 48 + s * 150 + throttle * 22;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.sub.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(500 + s * 1900, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(0.08 + s * 0.1, t, 0.12);
  }

  stopEngine() {
    if (!this.ctx || !this.engine) return;
    const { osc, sub, gain } = this.engine;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.08);
    // Stop slightly later so the fade is audible, then tear the nodes down.
    try {
      osc.stop(t + 0.35);
      sub.stop(t + 0.35);
    } catch {
      /* already stopped */
    }
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.engine = null;
  }

  // ---- Siren -------------------------------------------------------------

  startSiren() {
    if (!this.ctx || !this.master || this.siren || this.suspended) return;
    const ctx = this.ctx;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 640;

    // Slow LFO sweeping the pitch gives the classic two-tone wail.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.9;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;

    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(this.master);

    osc.start();
    lfo.start();
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.4);

    this.siren = { osc, lfo, lfoGain, gain };
  }

  /** Fade the siren with distance so far-off units stay subtle. */
  updateSiren(proximity01: number) {
    if (!this.ctx || !this.siren) return;
    const p = Math.max(0, Math.min(1, proximity01));
    this.siren.gain.gain.setTargetAtTime(
      0.012 + p * 0.075,
      this.ctx.currentTime,
      0.25,
    );
  }

  stopSiren() {
    if (!this.ctx || !this.siren) return;
    const { osc, lfo, gain } = this.siren;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.2);
    try {
      osc.stop(t + 0.7);
      lfo.stop(t + 0.7);
    } catch {
      /* ignore */
    }
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.siren = null;
  }

  // ---- Ambient -----------------------------------------------------------

  startAmbient() {
    if (!this.ctx || !this.master || this.ambient || this.suspended) return;
    const ctx = this.ctx;
    // Two seconds of filtered noise, looped: a soft city hiss.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish noise
      data[i] = last * 3.5;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    gain.gain.setTargetAtTime(0.045, ctx.currentTime, 1.2);

    this.ambient = { src, gain };
  }

  stopAmbient() {
    if (!this.ctx || !this.ambient) return;
    const { src, gain } = this.ambient;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.3);
    try {
      src.stop(t + 0.8);
    } catch {
      /* ignore */
    }
    src.onended = () => {
      try {
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    this.ambient = null;
  }

  // ---- One-shots ---------------------------------------------------------

  private oneShot(build: (ctx: AudioContext, dest: GainNode) => number) {
    if (!this.ctx || !this.master || this.suspended) return;
    if (this.liveOneShots >= MAX_CONCURRENT_ONESHOTS) return;
    this.liveOneShots++;
    const duration = build(this.ctx, this.master);
    window.setTimeout(
      () => {
        this.liveOneShots = Math.max(0, this.liveOneShots - 1);
      },
      duration * 1000 + 60,
    );
  }

  /** Impact / collision thud. */
  collision(strength = 1) {
    this.oneShot((ctx, dest) => {
      const dur = 0.32;
      const t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320 + strength * 500;

      const gain = ctx.createGain();
      gain.gain.value = Math.min(0.5, 0.18 + strength * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + dur);

      src.connect(filter).connect(gain).connect(dest);
      src.start(t);
      src.stop(t + dur);
      src.onended = () => {
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
      return dur;
    });
  }

  /** Tyre squeal for handbrake / hard slides. */
  skid() {
    this.oneShot((ctx, dest) => {
      const dur = 0.45;
      const t = ctx.currentTime;
      const len = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 7;

      const gain = ctx.createGain();
      gain.gain.value = 0.001;
      gain.gain.linearRampToValueAtTime(0.13, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + dur);

      src.connect(filter).connect(gain).connect(dest);
      src.start(t);
      src.stop(t + dur);
      src.onended = () => {
        try {
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
      return dur;
    });
  }

  /** Short melodic sting: rising = success, falling = failure. */
  jingle(kind: 'success' | 'fail' | 'blip' = 'blip') {
    this.oneShot((ctx, dest) => {
      const t = ctx.currentTime;
      const notes =
        kind === 'success'
          ? [523.25, 659.25, 783.99, 1046.5]
          : kind === 'fail'
            ? [392, 329.63, 261.63]
            : [880];
      const step = kind === 'blip' ? 0.09 : 0.12;
      const dur = notes.length * step + 0.25;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = kind === 'fail' ? 'triangle' : 'square';
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        const start = t + i * step;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.09, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + step + 0.18);

        osc.connect(gain).connect(dest);
        osc.start(start);
        osc.stop(start + step + 0.2);
        osc.onended = () => {
          try {
            gain.disconnect();
          } catch {
            /* ignore */
          }
        };
      });
      return dur;
    });
  }

  dispose() {
    this.stopEngine();
    this.stopSiren();
    this.stopAmbient();
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      this.master = null;
      void ctx.close().catch(() => {});
    }
  }
}

export const audio = new AudioManager();
