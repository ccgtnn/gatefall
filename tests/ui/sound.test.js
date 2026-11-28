import assert from 'node:assert/strict';
import test from 'node:test';
import { CUES, createSoundEffects } from '../../docs/ui/sound.js';

function audioStub() {
  const tones = [];
  const gains = [];
  const param = {
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  const node = { connect() {}, disconnect() {} };
  const context = {
    state: 'suspended', currentTime: 0, destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain() {
      const gain = { ...param };
      gains.push(gain);
      return { ...node, gain };
    },
    createOscillator() {
      const frequency = { ...param };
      return { ...node, frequency, start() { tones.push(frequency.value); }, stop() {} };
    },
  };
  return { tones, gains, context, AudioContext: function () { return context; } };
}

test('synthesis starts after unlock and produces distinct cues for the four game events', () => {
  const { tones, AudioContext } = audioStub();
  const sounds = createSoundEffects(true, AudioContext);
  sounds.play({ type: 'play' });
  assert.deepEqual(tones, []);
  sounds.unlock();
  for (const type of ['play', 'damage', 'pass', 'play']) sounds.play({ type });
  sounds.play({ type: 'round-end', winner: 'bot' });
  sounds.play({ type: 'round-end', winner: null });
  sounds.play({ type: 'round-end', winner: 'human' });
  assert.deepEqual(tones, [440, 165, 330, 440, 554, 659]);
});

test('muting silences the output and prevents new cues until enabled again', () => {
  const { tones, gains, AudioContext } = audioStub();
  const sounds = createSoundEffects(false, AudioContext);
  sounds.unlock();
  assert.equal(gains.length, 0);
  sounds.setEnabled(true);
  sounds.unlock();
  sounds.play({ type: 'play' });
  sounds.setEnabled(false);
  sounds.play({ type: 'damage' });
  assert.equal(gains[0].value, 0);
  assert.deepEqual(tones, [440]);
  sounds.setEnabled(true);
  sounds.play({ type: 'damage' });
  assert.deepEqual(tones, [440, 165]);
});

test('volume changes update the live mix and the sound check plays the sample cue', async () => {
  const { tones, gains, AudioContext } = audioStub();
  const sounds = createSoundEffects(true, AudioContext);
  await sounds.testSound();
  assert.equal(gains[0].value, .3);
  sounds.setVolume(.72);
  assert.equal(gains[0].value, .72);
  sounds.setEnabled(false);
  sounds.setVolume(.42);
  assert.equal(gains[0].value, 0);
  sounds.setEnabled(true);
  assert.equal(gains[0].value, .42);
  assert.deepEqual(tones, [440, 554, 659]);
});

test('journal feedback and match results each have a synthesized cue', () => {
  for (const kind of ['heal', 'armor-break', 'capture', 'target-marked', 'row-effect', 'power-loss',
    'growth', 'counter', 'order-ready', 'damage-heavy', 'match-win', 'match-loss']) {
    assert.ok(CUES[kind]?.notes.length, kind);
  }
  const { tones, AudioContext } = audioStub();
  const sounds = createSoundEffects(true, AudioContext);
  sounds.unlock();
  sounds.play({ type: 'damage', amount: 4 });
  sounds.play({ type: 'damage', amount: 5 });
  sounds.play({ type: 'armor', amount: -2, armor: 0 });
  sounds.play({ type: 'match-end', result: 'loss' });
  assert.deepEqual(tones, [165, 102, 76, 900, 680, 330, 262, 196]);
});
