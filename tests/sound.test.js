import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundEffects } from '../docs/sound.js';

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
