/* Flugsimulator – Hilfsfunktionen */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  const U = {
    KT: 1.943844, // m/s -> Knoten
    FT: 3.28084, // m -> Fuß
    DEG: 180 / Math.PI,
    RAD: Math.PI / 180,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    smoothstep(a, b, x) {
      const t = U.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    },
    /** Winkel auf -PI..PI normalisieren */
    wrapPi(a) {
      a = (a + Math.PI) % (2 * Math.PI);
      if (a < 0) a += 2 * Math.PI;
      return a - Math.PI;
    },
    /** Kurs 0..360 Grad */
    wrap360(d) {
      d %= 360;
      return d < 0 ? d + 360 : d;
    },
    /** deterministischer Zufallsgenerator */
    rng(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    /** Normalverteilte Zufallszahl */
    randn() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    hash2(ix, iz) {
      let h = (ix * 374761393 + iz * 668265263) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967296;
    },
    /** Value-Noise 0..1 */
    noise2(x, z) {
      const ix = Math.floor(x), iz = Math.floor(z);
      const fx = x - ix, fz = z - iz;
      const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
      const a = U.hash2(ix, iz), b = U.hash2(ix + 1, iz);
      const c = U.hash2(ix, iz + 1), d = U.hash2(ix + 1, iz + 1);
      return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
    },
    fbm(x, z, oct) {
      let s = 0, amp = 0.5, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) {
        s += amp * U.noise2(x * f + i * 17.3, z * f - i * 9.1);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
      }
      return s / norm;
    },
    pad(n, len) {
      let s = String(Math.round(n));
      while (s.length < len) s = '0' + s;
      return s;
    },
    fmtTime(sec) {
      sec = Math.max(0, Math.floor(sec));
      return Math.floor(sec / 60) + ':' + U.pad(sec % 60, 2);
    },
  };

  FS.U = U;
})();
