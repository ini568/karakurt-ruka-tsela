import assert from 'node:assert/strict';
import { createAudio } from '../../src/art/audio.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
let devices = [], failConnect = false, failSchedule = false;
class Node {
  constructor() {
    this.disconnected = false;
    this.gain = this.frequency = {
      value: 0, cancelScheduledValues() {}, setTargetAtTime() {},
      setValueAtTime() {}, exponentialRampToValueAtTime() {},
    };
  }
  connect() { if (failConnect) throw new Error('device refused graph'); }
  disconnect() { this.disconnected = true; }
  start() { if (failSchedule) throw new Error('device refused scheduling'); }
  stop() { this.stopped = true; }
}
class Device {
  constructor() { this.state = 'running'; this.currentTime = 1; this.nodes = []; devices.push(this); }
  createGain() { const node = new Node(); this.nodes.push(node); return node; }
  createOscillator() { return this.createGain(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
try {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Device });
  const audio = createAudio();
  audio.setMuted(true);
  assert.equal(await audio.unlock(), false);
  assert.equal(devices.length, 0, 'mute must not create a device');
  audio.setMuted(false);
  failConnect = true;
  assert.equal(await audio.unlock(), false);
  assert.equal(devices[0].state, 'closed');
  assert.ok(devices[0].nodes.every(node => node.disconnected));
  failConnect = false;
  assert.equal(await audio.unlock(), true, 'failed setup must allow retry');
  const device = devices.at(-1);
  failSchedule = true;
  audio.play('win');
  assert.ok(device.nodes.slice(1).every(node => node.disconnected), 'partial cue must be disconnected');
  failSchedule = false;
  device.currentTime++;
  audio.play('win');
  assert.equal(device.nodes.filter(node => !node.disconnected).length, 7);
  audio.dispose(); audio.dispose();
  assert.equal(device.state, 'closed');
  assert.ok(device.nodes.every(node => node.disconnected));
  assert.equal(await audio.unlock(), false);
  console.log('REGRESSION OK: muted unlock, failed graph retry, partial cue cleanup and idempotent audio disposal');
} finally {
  if (original) Object.defineProperty(globalThis, 'AudioContext', original);
  else delete globalThis.AudioContext;
}
