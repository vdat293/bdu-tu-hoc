/**
 * Killer Sudoku Sound System
 * Synthesizes crisp, responsive audio feedback using Web Audio API
 * with optional fallback to game sound files.
 */

const SoundManager = (function() {
  'use strict';

  let audioCtx = null;
  let isMuted = false;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(freq, type = 'sine', duration = 0.08, gainVal = 0.15) {
    if (isMuted) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  }

  return {
    toggleMute() {
      isMuted = !isMuted;
      return isMuted;
    },
    isMuted() {
      return isMuted;
    },
    playClick() {
      playTone(600, 'triangle', 0.04, 0.08);
    },
    playNumber(num = 1) {
      // Pitch rises with higher numbers (1 -> 9)
      const baseFreq = 340;
      const freq = baseFreq + (num * 35);
      playTone(freq, 'sine', 0.09, 0.12);
    },
    playNote() {
      playTone(850, 'triangle', 0.04, 0.06);
    },
    playErase() {
      playTone(240, 'sine', 0.06, 0.1);
    },
    playError() {
      if (isMuted) return;
      try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch (e) {}
    },
    playVictory() {
      if (isMuted) return;
      const notes = [440, 554.37, 659.25, 880, 1108.73];
      notes.forEach((f, idx) => {
        setTimeout(() => {
          playTone(f, 'sine', 0.25, 0.18);
        }, idx * 110);
      });
    },
    playPlace(num = 1) {
      this.playNumber(num);
    },
    playUndo() {
      playTone(320, 'sine', 0.05, 0.08);
    },
    playFanfare() {
      this.playVictory();
    },
    setEnabled(enabled) {
      isMuted = !enabled;
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SoundManager;
}
