// Âm thanh nhỏ tổng hợp bằng WebAudio, không cần file asset. Mute lưu localStorage.

const STORAGE_KEY = 'bdu_games_sound';
let context = null;

function audioContext() {
  if (context) return context;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try { context = new Ctor(); } catch { context = null; }
  return context;
}

function tone(frequency, { start = 0, duration = 0.12, type = 'sine', gain = 0.06 } = {}) {
  const ctx = audioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  volume.gain.value = gain;
  volume.gain.setValueAtTime(gain, ctx.currentTime + start);
  volume.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  oscillator.connect(volume);
  volume.connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

export const Sound = {
  enabled: (() => {
    try { return window.localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
  })(),

  toggle() {
    this.enabled = !this.enabled;
    try { window.localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch {}
    return this.enabled;
  },

  play(name) {
    if (!this.enabled) return;
    if (audioContext()?.state === 'suspended') audioContext().resume().catch(() => {});
    switch (name) {
      case 'move':
        tone(520, { duration: 0.07, type: 'triangle', gain: 0.05 });
        break;
      case 'capture':
        tone(420, { duration: 0.08, type: 'square', gain: 0.045 });
        tone(300, { start: 0.07, duration: 0.12, type: 'square', gain: 0.045 });
        break;
      case 'join':
        tone(660, { duration: 0.1, gain: 0.05 });
        tone(990, { start: 0.09, duration: 0.14, gain: 0.05 });
        break;
      case 'chat':
        tone(880, { duration: 0.05, type: 'triangle', gain: 0.035 });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((frequency, index) => tone(frequency, { start: index * 0.11, duration: 0.2, gain: 0.06 }));
        break;
      case 'lose':
        [440, 349, 262].forEach((frequency, index) => tone(frequency, { start: index * 0.13, duration: 0.22, type: 'sine', gain: 0.05 }));
        break;
      case 'tick':
        tone(900, { duration: 0.03, type: 'triangle', gain: 0.03 });
        break;
      default:
        tone(600, { duration: 0.08, gain: 0.04 });
    }
  }
};
