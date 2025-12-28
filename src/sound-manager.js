// 音效管理器 (Web Audio API)
window.soundManager = {
  ctx: null,
  muted: false,
  init: function () {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  },
  playTone: function (freq, type, duration, vol = 0.1) {
    if (this.muted) return;
    if (!this.ctx) this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.01,
      this.ctx.currentTime + duration
    );
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },
  playClick: function () {
    this.playTone(800, "sine", 0.1, 0.05);
  },
  playTick: function () {
    this.playTone(400, "square", 0.05, 0.03);
  },
  playWin: function () {
    if (!this.ctx) this.init();
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      this.playTone(freq, "triangle", 0.3, 0.1);
      // Arpeggio effect handled by manual calls if needed, but simple chord here
      // For better effect, let's just play a simple high chime
    });
    // Simple sequence
    this.playTone(523.25, "sine", 0.1, 0.1);
    setTimeout(() => this.playTone(659.25, "sine", 0.1, 0.1), 100);
    setTimeout(() => this.playTone(783.99, "sine", 0.4, 0.1), 200);
  },
  playAlarm: function () {
    this.playTone(880, "sawtooth", 0.5, 0.1);
    setTimeout(() => this.playTone(880, "sawtooth", 0.5, 0.1), 600);
  },
  playExplosion: function () {
    if (this.muted) return;
    if (!this.ctx) this.init();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.01, t + 1.5);
    gain.gain.setValueAtTime(1, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(t + 1.5);

    // Noise texture
    for (let i = 0; i < 5; i++) {
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = "square";
      osc2.frequency.value = Math.random() * 500 + 50;
      gain2.gain.setValueAtTime(0.1, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start();
      osc2.stop(t + 0.5);
    }
  },
};
