// Lazy, gesture-unlocked Web Audio. No media, timers, or browser globals at import time.
// Each voice: [startHz, endHz, delay, duration, waveform, peakGain]. Cues are short and
// differ in register: warning = high double tick, attack = low thud, catch = bright chirp,
// hurt = harsh descending buzz.
const VOICES = {
  warning: [[1180, 1180, 0, .05, 'square', .035], [1180, 1180, .085, .05, 'square', .035]],
  web: [[680, 290, 0, .1, 'sine', .08]],
  dash: [[190, 760, 0, .12, 'triangle', .09]],
  catch: [[880, 1320, 0, .07, 'sine', .1], [1320, 1760, .06, .1, 'sine', .07]],
  hurt: [[320, 70, 0, .2, 'sawtooth', .09], [90, 40, .02, .22, 'sine', .15]],
  attack: [[110, 36, 0, .16, 'triangle', .18]],
  wave: [[220, 220, 0, .18, 'sine', .07], [277, 277, .14, .22, 'sine', .06]],
  win: [[440, 440, 0, .22, 'triangle', .08], [554, 554, .15, .22, 'triangle', .08], [659, 880, .30, .55, 'sine', .10]],
  lose: [[220, 196, 0, .35, 'triangle', .08], [165, 82, .23, .65, 'sine', .10]],
};

export function createAudio() {
  let context = null, master = null, muted = false, disposed = false;
  const active = new Set();
  const last = new Map();
  const disconnect = (node) => { try { node?.disconnect(); } catch { /* Revoked device. */ } };
  const close = (device) => { try { Promise.resolve(device?.close()).catch(() => {}); } catch { /* Already closed. */ } };

  function unlock() {
    if (disposed || muted) return Promise.resolve(false);
    let candidate = null, gain = null;
    try {
      if (!context || context.state === 'closed') {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) return Promise.resolve(false);
        candidate = new Audio();
        gain = candidate.createGain();
        gain.gain.value = .38;
        gain.connect(candidate.destination);
        // Publish only a fully connected graph; a failed setup must be retryable.
        context = candidate; master = gain; last.clear();
      }
      const device = context;
      return Promise.resolve(['suspended', 'interrupted'].includes(device.state) ? device.resume() : undefined)
        .then(() => !disposed && !muted && device.state === 'running').catch(() => false);
    } catch {
      disconnect(gain); close(candidate);
      return Promise.resolve(false);
    }
  }

  function release(voice, stop = false) {
    active.delete(voice);
    if (voice.oscillator) {
      voice.oscillator.onended = null;
      if (stop) { try { voice.oscillator.stop(); } catch { /* Not started or already ended. */ } }
    }
    disconnect(voice.oscillator); disconnect(voice.envelope);
  }

  function play(type) {
    const created = [];
    try {
      // Device access can itself fail after revocation; audio must never break a frame.
      if (disposed || muted || !context || context.state !== 'running' || !Object.hasOwn(VOICES, type)) return;
      const now = context.currentTime;
      if (!Number.isFinite(now)) return;
      const notes = VOICES[type];
      // Bound dense bursts and reserve room for the entire cue, not just its first note.
      if (now - (last.get(type) ?? -10) < .045 || active.size + notes.length > 24) return;
      last.set(type, now);
      for (const [start, end, delay, duration, shape, volume] of notes) {
        const voice = { oscillator: null, envelope: null };
        created.push(voice);
        voice.oscillator = context.createOscillator();
        voice.envelope = context.createGain();
        const { oscillator, envelope } = voice;
        const t = now + delay;
        oscillator.type = shape;
        oscillator.frequency.setValueAtTime(start, t);
        oscillator.frequency.exponentialRampToValueAtTime(end, t + duration);
        envelope.gain.setValueAtTime(.0001, t);
        envelope.gain.exponentialRampToValueAtTime(volume, t + .009);
        envelope.gain.exponentialRampToValueAtTime(.0001, t + duration);
        oscillator.connect(envelope); envelope.connect(master); active.add(voice);
        oscillator.onended = () => release(voice);
        oscillator.start(t); oscillator.stop(t + duration + .03);
      }
    } catch {
      // Also remove partially connected nodes if scheduling fails halfway through a cue.
      for (const voice of created) release(voice, true);
    }
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (!master || !context || disposed) return;
    try {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : .38, context.currentTime, .015);
    } catch { /* Closed audio device. */ }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const voice of [...active]) release(voice, true);
    active.clear(); last.clear();
    disconnect(master); close(context);
    master = null; context = null;
  }
  return { unlock, play, setMuted, dispose };
}
