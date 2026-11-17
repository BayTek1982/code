/* Flugsimulator – Sound: alles wird live erzeugt (Web Audio), keine Dateien nötig */
(function () {
  'use strict';
  const FS = window.FS;
  const { clamp, KT } = FS.U;

  const A = {
    ctx: null,
    muted: false,
    active: false,
    speechOK: typeof window.speechSynthesis !== 'undefined',
    voice: null,
    timers: {},
    lastRa: 9999,

    /** muss aus einem Klick heraus aufgerufen werden */
    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      let ctx;
      try {
        ctx = new AC();
      } catch (e) {
        return;
      }
      this.ctx = ctx;
      const master = (this.master = ctx.createGain());
      master.gain.value = this.muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.amb = ctx.createGain();
      this.amb.gain.value = 0;
      this.amb.connect(master);
      this.sfx = ctx.createGain();
      this.sfx.connect(master);
      this.alarm = ctx.createGain();
      this.alarm.gain.value = 0.8;
      this.alarm.connect(master);

      // Rauschpuffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.25 * w) / 1.25; // leicht gefärbt
        d[i] = w * 0.55 + last * 1.6;
      }
      this.noiseBuf = buf;

      this.engN = [this._mkEngine(-0.5), this._mkEngine(0.5)];
      this.wind = this._mkNoise('bandpass', 600, 0.6, this.amb);
      this.gearWind = this._mkNoise('lowpass', 260, 0.7, this.amb);
      this.rumble = this._mkNoise('lowpass', 110, 0.9, this.amb);
      this.rain = this._mkNoise('highpass', 2600, 0.5, this.amb);
      this.fireN = this._mkNoise('bandpass', 900, 1.5, this.amb);
      // Stall-Rüttler
      this.shaker = this._mkNoise('bandpass', 170, 2.5, this.alarm);
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 27;
      this.shakerLfoGain = ctx.createGain();
      this.shakerLfoGain.gain.value = 0;
      lfo.connect(this.shakerLfoGain);
      this.shakerLfoGain.connect(this.shaker.gain.gain);
      lfo.start();
      // Motoren (Fahrwerk / Klappen)
      this.gearMotor = this._mkOsc('sawtooth', 92, 480, this.sfx);
      this.flapMotor = this._mkOsc('sawtooth', 232, 900, this.sfx);

      if (this.speechOK) {
        const pick = () => {
          try {
            const vs = window.speechSynthesis.getVoices();
            this.voice = vs.find((v) => /^en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
          } catch (e) { /* egal */ }
        };
        pick();
        try {
          window.speechSynthesis.onvoiceschanged = pick;
        } catch (e) { /* egal */ }
      }
    },

    _mkNoise(type, freq, q, dest) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(dest);
      src.start();
      return { filter: f, gain: g };
    },

    _mkOsc(type, freq, lp, dest) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(f);
      f.connect(g);
      g.connect(dest);
      o.start();
      return { osc: o, gain: g };
    },

    _mkEngine(pan) {
      const ctx = this.ctx;
      const out = ctx.createGain();
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        out.connect(p);
        p.connect(this.amb);
      } else out.connect(this.amb);
      const whine = this._mkOsc('sine', 800, 8000, out);
      const hum = this._mkOsc('triangle', 150, 1200, out);
      const roar = this._mkNoise('bandpass', 300, 0.7, out);
      const low = this._mkNoise('lowpass', 95, 0.8, out);
      return { whine, hum, roar, low };
    },

    setMuted(m) {
      this.muted = m;
      if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
      if (m) this._cancelSpeech();
    },

    /** Dauergeräusche ein/aus (Menü, Pause) */
    setActive(on) {
      this.active = on;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.amb.gain.setTargetAtTime(on ? 1 : 0, t, 0.15);
      this.alarm.gain.setTargetAtTime(on ? 0.8 : 0, t, 0.05);
      if (!on) {
        this.shaker.gain.gain.setTargetAtTime(0, t, 0.02);
        this.shakerLfoGain.gain.setTargetAtTime(0, t, 0.02);
        this.gearMotor.gain.gain.setTargetAtTime(0, t, 0.05);
        this.flapMotor.gain.gain.setTargetAtTime(0, t, 0.05);
        this._cancelSpeech();
      }
    },

    _cancelSpeech() {
      if (!this.speechOK) return;
      try {
        window.speechSynthesis.cancel();
      } catch (e) { /* egal */ }
    },

    speak(text, urgent) {
      if (!this.speechOK || this.muted || !this.ctx) return;
      try {
        const ss = window.speechSynthesis;
        if (urgent) ss.cancel();
        else if (ss.speaking || ss.pending) return;
        // ohne englische Stimme: deutsche Ansagen
        const de = { 'Stall!': 'Überzogen!', 'Pull up!': 'Hochziehen!', 'Sink rate': 'Sinkrate!', 'Too low. Gear!': 'Zu tief. Fahrwerk!', 'Bank angle': 'Querneigung!' };
        const u = new SpeechSynthesisUtterance(this.voice ? text : de[text] || text);
        u.lang = this.voice ? 'en-US' : 'de-DE';
        if (this.voice) u.voice = this.voice;
        u.rate = 1.15;
        u.pitch = 0.9;
        u.volume = 0.9;
        ss.speak(u);
      } catch (e) { /* egal */ }
    },

    /* ---------- Einzelklänge ---------- */
    tone(freq, dur, opt) {
      if (!this.ctx) return;
      opt = opt || {};
      const ctx = this.ctx, t0 = ctx.currentTime + (opt.delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = opt.type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
      const v = opt.vol == null ? 0.2 : opt.vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(v, t0 + (opt.attack || 0.008));
      if (opt.decay) g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      else {
        g.gain.setValueAtTime(v, t0 + Math.max(0.01, dur - 0.02));
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      }
      o.connect(g);
      g.connect(opt.dest || this.alarm);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },

    burst(dur, opt) {
      if (!this.ctx) return;
      opt = opt || {};
      const ctx = this.ctx, t0 = ctx.currentTime + (opt.delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = opt.type || 'lowpass';
      f.frequency.setValueAtTime(opt.freq || 800, t0);
      if (opt.to) f.frequency.exponentialRampToValueAtTime(opt.to, t0 + dur);
      f.Q.value = opt.q || 0.7;
      const g = ctx.createGain();
      const v = opt.vol == null ? 0.4 : opt.vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(v, t0 + (opt.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(opt.dest || this.sfx);
      src.start(t0, Math.random());
      src.stop(t0 + dur + 0.05);
    },

    play(name, arg) {
      if (!this.ctx) return;
      switch (name) {
        case 'click':
          this.tone(1400, 0.03, { vol: 0.08, dest: this.sfx, type: 'square' });
          break;
        case 'caution':
          this.tone(880, 0.2, { vol: 0.22 });
          this.tone(660, 0.32, { vol: 0.22, delay: 0.2 });
          break;
        case 'warning':
          for (let i = 0; i < 3; i++) this.tone(1050, 0.11, { vol: 0.2, type: 'square', delay: i * 0.17 });
          break;
        case 'bell':
          this.tone(1245, 0.22, { vol: 0.13, decay: true });
          this.tone(1870, 0.18, { vol: 0.09, decay: true });
          this.tone(2610, 0.12, { vol: 0.05, decay: true });
          break;
        case 'whoop':
          this.tone(480, 0.32, { vol: 0.2, type: 'sawtooth', to: 1150 });
          this.tone(480, 0.32, { vol: 0.2, type: 'sawtooth', to: 1150, delay: 0.38 });
          break;
        case 'chirp':
          this.tone(1500, 0.07, { vol: 0.14, type: 'square' });
          this.tone(1500, 0.07, { vol: 0.14, type: 'square', delay: 0.12 });
          break;
        case 'clack':
          this.burst(0.035, { type: 'highpass', freq: 1800, vol: 0.3, dest: this.alarm });
          break;
        case 'horn':
          this.tone(520, 0.24, { vol: 0.1, type: 'square' });
          break;
        case 'touchdown': {
          const s = clamp((arg || 1) / 4, 0.25, 1.4);
          this.burst(0.18, { type: 'bandpass', freq: 2100, to: 900, q: 2.5, vol: 0.4 * s });
          this.tone(75, 0.3, { vol: 0.5 * s, to: 38, decay: true, dest: this.sfx });
          this.burst(0.3, { type: 'lowpass', freq: 240, vol: 0.5 * s });
          break;
        }
        case 'bang':
          this.burst(0.5, { type: 'lowpass', freq: 900, to: 90, vol: 1.0 });
          this.tone(70, 0.5, { vol: 0.8, to: 30, decay: true, dest: this.sfx });
          this.burst(0.9, { type: 'bandpass', freq: 300, to: 120, vol: 0.4, delay: 0.25 });
          break;
        case 'bird':
          this.tone(110, 0.22, { vol: 0.9, to: 45, decay: true, dest: this.sfx });
          this.burst(0.25, { type: 'highpass', freq: 2500, vol: 0.5 });
          this.burst(0.12, { type: 'highpass', freq: 4000, vol: 0.35, delay: 0.18 });
          break;
        case 'explosion':
          this.burst(2.4, { type: 'lowpass', freq: 2200, to: 60, vol: 1.6, attack: 0.01 });
          this.tone(55, 1.6, { vol: 1.0, to: 22, decay: true, dest: this.sfx });
          this.burst(1.2, { type: 'highpass', freq: 1500, vol: 0.5, delay: 0.05 });
          break;
        case 'splash':
          this.burst(1.8, { type: 'bandpass', freq: 900, to: 300, q: 0.4, vol: 1.2 });
          break;
        case 'gearLock':
          this.tone(120, 0.14, { vol: 0.45, to: 60, decay: true, dest: this.sfx });
          this.burst(0.06, { type: 'bandpass', freq: 1500, vol: 0.25 });
          break;
        case 'thunder':
          for (let i = 0; i < 4; i++) {
            this.burst(1.6 + Math.random() * 1.8, { type: 'lowpass', freq: 160 + Math.random() * 220, to: 50, vol: 0.9 - i * 0.15, delay: (arg || 0) + i * (0.25 + Math.random() * 0.4), attack: 0.04 });
          }
          break;
        case 'hiss':
          this.burst(1.8, { type: 'highpass', freq: 3200, vol: 0.35 });
          break;
        case 'powerDown':
          this.tone(900, 1.3, { vol: 0.14, to: 60, dest: this.sfx });
          this.burst(0.05, { type: 'highpass', freq: 2000, vol: 0.3 });
          break;
        case 'powerUp':
          this.tone(120, 1.0, { vol: 0.1, to: 880, dest: this.sfx });
          break;
        case 'ding':
          this.tone(784, 0.5, { vol: 0.16, decay: true, dest: this.sfx });
          this.tone(587, 0.8, { vol: 0.16, decay: true, delay: 0.32, dest: this.sfx });
          break;
        case 'gate':
          this.tone(988, 0.09, { vol: 0.1, dest: this.sfx });
          this.tone(1319, 0.16, { vol: 0.1, delay: 0.09, dest: this.sfx });
          break;
        case 'success':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, { vol: 0.14, delay: i * 0.14, decay: true, dest: this.sfx }));
          break;
      }
    },

    resetAlarms() {
      this.timers = {};
      this.lastRa = 9999;
    },

    _every(key, period, dt, fn) {
      const t = (this.timers[key] || 0) - dt;
      if (t <= 0) {
        fn();
        this.timers[key] = period;
      } else this.timers[key] = t;
    },

    /**
     * Pro Frame aufrufen.
     * st: {ac, warn, masterWarn, rainOn, paused}
     */
    update(dt, st) {
      if (!this.ctx || !this.active) return;
      const ctx = this.ctx, t = ctx.currentTime, ac = st.ac;
      const set = (param, v, tc) => param.setTargetAtTime(v, t, tc || 0.08);

      // Triebwerke
      for (let i = 0; i < 2; i++) {
        const e = ac.eng[i], n = this.engN[i];
        const n1 = e.n1;
        const on = n1 > 0.04 ? 1 : 0;
        set(n.whine.osc.frequency, 520 + n1 * 2500);
        set(n.whine.gain.gain, on * (0.004 + 0.02 * n1 * n1));
        set(n.hum.osc.frequency, 95 + n1 * 330);
        set(n.hum.gain.gain, on * 0.05 * n1);
        set(n.roar.filter.frequency, 200 + n1 * 750);
        set(n.roar.gain.gain, on * (0.03 + 0.5 * n1 * n1));
        set(n.low.gain.gain, on * 0.5 * Math.pow(n1, 1.5));
      }
      const fire = ac.eng[0].fire || ac.eng[1].fire;
      set(this.fireN.gain.gain, fire ? 0.12 + 0.06 * Math.random() : 0, 0.05);

      // Fahrtwind
      const v = ac.tas || 0;
      set(this.wind.filter.frequency, 350 + v * 9);
      set(this.wind.gain.gain, Math.min(0.75, Math.pow(v / 125, 2) * 0.42));
      const gearExt = (ac.gear[0] + ac.gear[1] + ac.gear[2]) / 3;
      set(this.gearWind.gain.gain, ac.onGround ? 0 : Math.min(0.5, gearExt * Math.pow(v / 90, 2) * 0.35 + ac.flaps * 0.02 * Math.pow(v / 80, 2)));
      set(this.rumble.gain.gain, ac.onGround ? Math.min(1.1, (ac.gs / 60) * (ac.surface === 'runway' || ac.surface === 'paved' ? 0.55 : 1.3)) : 0, 0.05);
      set(this.rumble.filter.frequency, 70 + ac.gs * 1.5);
      set(this.rain.gain.gain, st.rainOn ? 0.1 + Math.min(0.14, v / 900) : 0, 0.3);

      // Motoren
      set(this.gearMotor.gain.gain, ac.gearMoving ? 0.07 : 0, 0.05);
      set(this.flapMotor.gain.gain, ac.flapsMoving ? 0.035 : 0, 0.05);

      // ---- Alarme
      const w = st.warn;
      set(this.shaker.gain.gain, w.stall ? 0.35 : 0, 0.02);
      set(this.shakerLfoGain.gain, w.stall ? 0.35 : 0, 0.02);
      if (w.stall) this._every('stall', 1.3, dt, () => { this.play('chirp'); this.speak('Stall!', false); });
      else this.timers.stall = 0;

      if (fire) this._every('bell', 0.105, dt, () => this.play('bell'));
      if (st.masterWarn && !fire) this._every('mw', 2.2, dt, () => this.play('warning'));
      else this.timers.mw = 0.6;

      if (w.pullUp) this._every('pull', 1.5, dt, () => { this.play('whoop'); this.speak('Pull up!', true); });
      else {
        this.timers.pull = 0;
        if (w.sinkRate) this._every('sink', 2.6, dt, () => { this.play('chirp'); this.speak('Sink rate', false); });
        else this.timers.sink = 0;
        if (w.gear) this._every('gear', 0.42, dt, () => this.play('horn'));
        if (w.gear) this._every('gearV', 3.5, dt, () => this.speak('Too low. Gear!', false));
        else this.timers.gearV = 0;
        if (w.bank) this._every('bank', 2.5, dt, () => this.speak('Bank angle', false));
        else this.timers.bank = 0;
      }
      if (w.overspeed) this._every('clack', 0.13, dt, () => this.play('clack'));

      // Höhenansagen im Endanflug
      const ra = w.raFt;
      if (w.gearDown && !ac.onGround && ac.vs < -0.3 && !w.pullUp) {
        for (const th of [500, 400, 300, 200, 100, 50, 40, 30, 20, 10]) {
          if (this.lastRa > th && ra <= th) {
            this.speak(String(th), true);
            if (!this.speechOK) this.tone(th <= 50 ? 1200 : 900, 0.06, { vol: 0.1 });
            break;
          }
        }
      }
      this.lastRa = ra;
    },
  };

  FS.Audio = A;
})();
