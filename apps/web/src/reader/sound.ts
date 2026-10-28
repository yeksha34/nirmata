import type { Mood } from "./book";

/**
 * The room the book is read in, made of nothing but the Web Audio API: noise through filters for
 * wind, rain and fire, a few slow sine tones for a pad, small bursts for crackle and crickets, and
 * a swish of paper for each page turned. No sound files. It makes no noise until the reader asks
 * for it, and it stops when the reader closes.
 */

export type Layer = "wind" | "rain" | "fire" | "pad" | "crickets";

const LAYERS: Record<Mood, Layer[]> = {
  dusk: ["wind", "pad"],
  ember: ["fire", "pad"],
  forest: ["wind", "crickets", "pad"],
  rain: ["rain", "pad"],
  moon: ["wind", "pad"],
  ink: ["pad"],
};

/** The tones of each mood's pad, in hertz: a warm open chord, or a minor one. */
const CHORD: Record<Mood, number[]> = {
  dusk: [196, 246.9, 293.7],
  ember: [98, 146.8, 196, 246.9],
  forest: [130.8, 196, 261.6],
  rain: [110, 164.8, 220],
  moon: [110, 164.8, 220, 261.6],
  ink: [130.8, 196],
};

export const layersFor = (mood: Mood): Layer[] => LAYERS[mood];

export interface Ambience {
  setMood(mood: Mood): void;
  /** The swish of one page. */
  flip(): void;
  close(): void;
}

const FADE = 1.4;

type Stop = () => void;

/** Starts the sound of `mood`, or returns nothing where the browser has no Web Audio. */
export function openAmbience(mood: Mood): Ambience | null {
  const Context =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Context) return null;
  const ctx = new Context();
  void ctx.resume();

  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
  master.connect(ctx.destination);

  const noise = (kind: "white" | "brown") => {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === "white") data[i] = white;
      else {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
    }
    return buffer;
  };
  const buffers = { white: noise("white"), brown: noise("brown") };

  const source = (kind: "white" | "brown", loop: boolean) => {
    const s = ctx.createBufferSource();
    s.buffer = buffers[kind];
    s.loop = loop;
    return s;
  };

  /** A slow wobble on a parameter, so nothing holds perfectly still. */
  const wobble = (param: AudioParam, hz: number, depth: number, stops: Stop[]) => {
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = hz;
    amount.gain.value = depth;
    lfo.connect(amount).connect(param);
    lfo.start();
    stops.push(() => lfo.stop());
  };

  /** A short burst of noise through a band: a crackle, a swish, a chirp's bed. */
  const burst = (
    out: AudioNode,
    from: number,
    to: number,
    q: number,
    peak: number,
    seconds: number,
  ) => {
    const s = source("white", false);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = q;
    band.frequency.setValueAtTime(from, ctx.currentTime);
    band.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(peak, ctx.currentTime + Math.min(0.03, seconds / 3));
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
    s.connect(band).connect(env).connect(out);
    s.start(ctx.currentTime, Math.random() * 2, seconds + 0.05);
  };

  const build = (layer: Layer, chord: number[], out: AudioNode): Stop => {
    const stops: Stop[] = [];
    switch (layer) {
      case "wind": {
        const s = source("brown", true);
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 380;
        band.Q.value = 0.7;
        const level = ctx.createGain();
        level.gain.value = 0.55;
        s.connect(band).connect(level).connect(out);
        wobble(level.gain, 0.07, 0.3, stops);
        wobble(band.frequency, 0.05, 160, stops);
        s.start();
        stops.push(() => s.stop());
        break;
      }
      case "rain": {
        const s = source("white", true);
        const high = ctx.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 900;
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 7500;
        const level = ctx.createGain();
        level.gain.value = 0.13;
        s.connect(high).connect(low).connect(level).connect(out);
        wobble(level.gain, 0.11, 0.025, stops);
        s.start();
        stops.push(() => s.stop());
        break;
      }
      case "fire": {
        const s = source("brown", true);
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 230;
        const level = ctx.createGain();
        level.gain.value = 0.5;
        s.connect(low).connect(level).connect(out);
        wobble(level.gain, 0.4, 0.12, stops);
        s.start();
        stops.push(() => s.stop());
        let timer = 0;
        const crackle = () => {
          const pop = 1800 + Math.random() * 2800;
          burst(out, pop, pop * 0.6, 1.6, 0.06 + Math.random() * 0.12, 0.03 + Math.random() * 0.07);
          timer = window.setTimeout(crackle, 50 + Math.random() * 520);
        };
        crackle();
        stops.push(() => window.clearTimeout(timer));
        break;
      }
      case "crickets": {
        let timer = 0;
        const chirp = () => {
          const pitch = 3900 + Math.random() * 500;
          for (let i = 0; i < 3; i++) {
            const o = ctx.createOscillator();
            const env = ctx.createGain();
            const at = ctx.currentTime + i * 0.07;
            o.frequency.value = pitch;
            env.gain.setValueAtTime(0, at);
            env.gain.linearRampToValueAtTime(0.018, at + 0.012);
            env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
            o.connect(env).connect(out);
            o.start(at);
            o.stop(at + 0.06);
          }
          timer = window.setTimeout(chirp, 700 + Math.random() * 2600);
        };
        timer = window.setTimeout(chirp, 600);
        stops.push(() => window.clearTimeout(timer));
        break;
      }
      case "pad": {
        const low = ctx.createBiquadFilter();
        low.type = "lowpass";
        low.frequency.value = 900;
        const level = ctx.createGain();
        level.gain.value = 0.9 / chord.length;
        low.connect(level).connect(out);
        chord.forEach((hz, i) => {
          const o = ctx.createOscillator();
          o.type = i % 2 ? "triangle" : "sine";
          o.frequency.value = hz;
          o.detune.value = ((i % 3) - 1) * 7;
          const own = ctx.createGain();
          own.gain.value = 0.07;
          o.connect(own).connect(low);
          wobble(own.gain, 0.05 + i * 0.013, 0.035, stops);
          o.start();
          stops.push(() => o.stop());
        });
        break;
      }
    }
    return () => {
      for (const stop of stops) {
        try {
          stop();
        } catch {
          // already stopped
        }
      }
    };
  };

  let current: { bus: GainNode; stop: Stop[] } | undefined;
  let closed = false;

  const play = (mood: Mood) => {
    const old = current;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    bus.connect(master);
    current = { bus, stop: LAYERS[mood].map((layer) => build(layer, CHORD[mood], bus)) };
    if (old) {
      old.bus.gain.cancelScheduledValues(ctx.currentTime);
      old.bus.gain.setValueAtTime(old.bus.gain.value, ctx.currentTime);
      old.bus.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
      window.setTimeout(
        () => {
          for (const stop of old.stop) stop();
          old.bus.disconnect();
        },
        FADE * 1000 + 100,
      );
    }
  };
  play(mood);

  return {
    setMood: (next) => {
      if (!closed) play(next);
    },
    flip: () => {
      if (!closed) burst(master, 1300, 3800, 0.9, 0.2, 0.24);
    },
    close: () => {
      if (closed) return;
      closed = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      window.setTimeout(() => {
        for (const stop of current?.stop ?? []) stop();
        void ctx.close();
      }, 400);
    },
  };
}
