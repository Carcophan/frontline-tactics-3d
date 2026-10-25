/**
 * Procedural Web Audio API Sound Engine for RISIKO 3D
 * Generates tactical UI sounds, dice rolls, artillery fire, explosions,
 * troop marches, card trade chimes, and capture/victory fanfares without external assets.
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private _muted = false;
  private _volume = 0.65;

  private ensureContext(): AudioContext | null {
    if (this._muted) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public get muted(): boolean {
    return this._muted;
  }

  public set muted(val: boolean) {
    this._muted = val;
  }

  public toggleMute(): boolean {
    this._muted = !this._muted;
    if (!this._muted) {
      this.playClick();
    }
    return this._muted;
  }

  public get volume(): number {
    return this._volume;
  }

  public set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
  }

  /**
   * Subtle tactical click when selecting a territory or UI button
   */
  public playClick(pitchMultiplier = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520 * pitchMultiplier, now);
    osc.frequency.exponentialRampToValueAtTime(180 * pitchMultiplier, now + 0.055);

    gain.gain.setValueAtTime(0.18 * this._volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  /**
   * Deployment / reinforcement placement sound
   */
  public playReinforce(amount = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const count = Math.min(3, Math.max(1, Math.ceil(amount / 3)));

    for (let i = 0; i < count; i++) {
      const offset = i * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const baseFreq = 320 + i * 90;
      osc.frequency.setValueAtTime(baseFreq, now + offset);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + offset + 0.09);

      gain.gain.setValueAtTime(0.22 * this._volume, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.11);
    }
  }

  /**
   * Tumbling 3D dice clatter sound
   */
  public playDiceRoll(diceCount = 3): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const hits = Math.min(7, Math.max(3, diceCount + 2));

    for (let i = 0; i < hits; i++) {
      const delay = i * 0.042 + Math.random() * 0.015;
      // Short filtered noise burst + woody resonant ping
      const bufferSize = Math.floor(ctx.sampleRate * 0.03);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.3));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900 + Math.random() * 700, now + delay);
      filter.Q.setValueAtTime(3.5, now + delay);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.26 * this._volume, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.03);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(now + delay);
      noise.stop(now + delay + 0.032);
    }
  }

  /**
   * Artillery / cannon firing sound
   */
  public playCannonFire(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.16);

    gain.gain.setValueAtTime(0.24 * this._volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  /**
   * Combat impact / explosion sound
   */
  public playExplosion(intensity = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 0.28 * Math.min(1.5, Math.max(0.7, intensity));
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(65, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.38 * this._volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);

    // Sub-bass punch
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + duration * 0.85);

    subGain.gain.setValueAtTime(0.32 * this._volume, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.85);

    sub.connect(subGain);
    subGain.connect(ctx.destination);

    sub.start(now);
    sub.stop(now + duration);
  }

  /**
   * Territory capture fanfare
   */
  public playCapture(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Triumphant major triad fanfare (C5 - E5 - G5 - C6)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.065;
      const dur = idx === notes.length - 1 ? 0.32 : 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.22 * this._volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + dur + 0.01);
    });
  }

  /**
   * Troop movement / marching cadence
   */
  public playMarch(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = now + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140 + i * 15, start);
      osc.frequency.exponentialRampToValueAtTime(60, start + 0.06);

      gain.gain.setValueAtTime(0.18 * this._volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.065);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.07);
    }
  }

  /**
   * Risk Card trade-in gold shimmer
   */
  public playCardTrade(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [440, 554.37, 659.25, 880, 1108.73];
    freqs.forEach((freq, idx) => {
      const start = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.2 * this._volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  /**
   * Phase transition / turn start cue
   */
  public playPhaseChange(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(480, now + 0.11);

    gain.gain.setValueAtTime(0.15 * this._volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  }

  /**
   * Opponent eliminated dramatic chord
   */
  public playElimination(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const freqs = [196.0, 293.66, 392.0, 587.33];
    freqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + 0.55);

      gain.gain.setValueAtTime(0.14 * this._volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.58);
    });
  }

  /**
   * Grand Victory Fanfare
   */
  public playVictory(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const melody = [
      { f: 523.25, t: 0.0, d: 0.16 },
      { f: 523.25, t: 0.17, d: 0.16 },
      { f: 523.25, t: 0.34, d: 0.16 },
      { f: 659.25, t: 0.52, d: 0.32 },
      { f: 587.33, t: 0.86, d: 0.22 },
      { f: 659.25, t: 1.1, d: 0.22 },
      { f: 783.99, t: 1.35, d: 0.65 },
    ];

    for (const note of melody) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, now + note.t);

      gain.gain.setValueAtTime(0.28 * this._volume, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + note.t + note.d);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.t);
      osc.stop(now + note.t + note.d + 0.02);
    }
  }
}

export const sound = new SoundManager();
