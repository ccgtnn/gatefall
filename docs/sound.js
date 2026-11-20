const CUES = {
  play: { wave: 'triangle', notes: [[440, 320, 0, .085]] },
  damage: { wave: 'sine', notes: [[165, 85, 0, .12]] },
  pass: { wave: 'sine', notes: [[330, 240, 0, .13]] },
  win: { wave: 'triangle', notes: [[440, 440, 0, .095], [554, 554, .075, .095], [659, 659, .15, .16]] },
};

export function createSoundEffects(initiallyEnabled, AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext) {
  let enabled = initiallyEnabled;
  let context;
  let volume;
  const lastPlayed = new Map();

  function setEnabled(value) {
    enabled = value;
    if (volume) volume.gain.setValueAtTime(value ? .045 : 0, context.currentTime);
  }

  function unlock() {
    if (!enabled || !AudioContext) return;
    try {
      if (!context) {
        context = new AudioContext();
        volume = context.createGain();
        volume.gain.value = .045;
        volume.connect(context.destination);
      }
      if (context.state !== 'running') context.resume().catch(() => {});
    } catch {
      // Sound is optional when the browser cannot open an audio output.
    }
  }

  function play(event) {
    if (!enabled || context?.state !== 'running') return;
    const kind = event.type === 'round-end' && event.winner === 'human' ? 'win' : event.type;
    if (!Object.hasOwn(CUES, kind)) return;
    const { wave, notes } = CUES[kind];
    const now = context.currentTime;
    if (now - (lastPlayed.get(kind) ?? -Infinity) < .075) return;
    lastPlayed.set(kind, now);
    for (const [pitch, endPitch, delay, duration] of notes) {
      const start = now + delay + .006;
      const end = start + duration;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(pitch, start);
      oscillator.frequency.exponentialRampToValueAtTime(endPitch, end);
      envelope.gain.setValueAtTime(.001, start);
      envelope.gain.linearRampToValueAtTime(.7, start + .012);
      envelope.gain.exponentialRampToValueAtTime(.001, end);
      oscillator.connect(envelope);
      envelope.connect(volume);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end);
    }
  }

  return { setEnabled, unlock, play };
}
