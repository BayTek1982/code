/* Flugsimulator – Welt: Gelände, Flughäfen, Himmel, Wetter, Wegpunkt-Tore */
(function () {
  'use strict';
  const FS = window.FS;
  const U = FS.U;
  const { clamp, lerp, smoothstep, RAD, DEG } = U;

  const SIZE = 56000; // Kantenlänge des Geländes in m
  const N = 281; // Stützpunkte pro Kante
  const CELL = SIZE / (N - 1);
  const HALF = SIZE / 2;
  const GS_TAN = Math.tan(3 * RAD);
  const RW_MESH_W = 60; // Bahn inkl. Schultern

  const MOUNTAINS = [
    { x: -6000, z: -8000, r: 8500, a: 1.0 },
    { x: 9000, z: 10500, r: 7000, a: 0.85 },
    { x: 0, z: -17000, r: 6000, a: 0.7 },
    { x: 20000, z: -1000, r: 4000, a: 0.5 },
    { x: -17500, z: -4000, r: 4500, a: 0.55 },
  ];
  const LAKES = [
    { x: -7200, z: 10800, r: 2900, d: 170 },
    { x: 1200, z: 400, r: 2100, d: 150 },
  ];

  function mkAirport(o) {
    const hdg = o.hdgDeg * RAD;
    const fx = Math.sin(hdg), fz = -Math.cos(hdg);
    const rx = Math.cos(hdg), rz = Math.sin(hdg);
    const ap = Object.assign({}, o, { hdg, fx, fz, rx, rz });
    const id = (d) => U.pad(Math.round(U.wrap360(d) / 10) || 36, 2);
    const mkEnd = (dir, hdgDeg) => {
      const h = hdgDeg * RAD;
      const efx = Math.sin(h), efz = -Math.cos(h);
      const thr = { x: o.x - efx * o.len / 2, z: o.z - efz * o.len / 2 };
      return {
        ap, id: id(hdgDeg), hdg: h, hdgDeg: U.wrap360(hdgDeg), fx: efx, fz: efz,
        rx: Math.cos(h), rz: Math.sin(h), thr,
        aim: { x: thr.x + efx * 300, z: thr.z + efz * 300 },
      };
    };
    ap.ends = [mkEnd(1, o.hdgDeg), mkEnd(-1, o.hdgDeg + 180)];
    return ap;
  }

  const airports = [
    mkAirport({ name: 'Seeblick', code: 'SBK', x: -13000, z: 6000, elev: 14, hdgDeg: 90, len: 2400, width: 45, side: 1 }),
    mkAirport({ name: 'Adlerhorst', code: 'ADL', x: 11000, z: -9000, elev: 90, hdgDeg: 30, len: 2400, width: 45, side: -1 }),
  ];

  /* ---------- Höhenfunktion ---------- */
  function airportMask(ap, x, z) {
    const dx = x - ap.x, dz = z - ap.z;
    const along = dx * ap.fx + dz * ap.fz;
    const lat = dx * ap.rx + dz * ap.rz;
    const da = Math.max(0, Math.abs(along) - (ap.len / 2 + 700));
    const dist = Math.hypot(da, lat);
    return { m: 1 - smoothstep(900, 3800, dist), along, lat };
  }

  function rawHeight(x, z) {
    const d = Math.hypot(x * 0.92, z) / 24000;
    const coastN = U.fbm(x / 6000 + 40, z / 6000 + 40, 3);
    const isl = smoothstep(1.02, 0.72, d + (coastN - 0.5) * 0.28);
    const hills = U.fbm(x / 3500, z / 3500, 4);
    let mw = 0;
    for (const m of MOUNTAINS) {
      const dd = ((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z)) / (m.r * m.r);
      mw = Math.max(mw, m.a * Math.exp(-dd * 1.2));
    }
    const n = U.fbm(x / 6500 + 11, z / 6500 + 5, 5);
    const rr = 1 - Math.abs(2 * U.fbm(x / 4200 - 7, z / 4200 + 3, 4) - 1);
    let h = 16 + hills * 110 + mw * (Math.pow(n, 1.3) * 1150 + rr * rr * 750);
    for (const l of LAKES) {
      const dd = ((x - l.x) * (x - l.x) + (z - l.z) * (z - l.z)) / (l.r * l.r);
      h -= l.d * Math.exp(-dd);
    }
    h = h * isl - (1 - isl) * 60;
    return h;
  }

  function terrainHeight(x, z) {
    let h = rawHeight(x, z);
    for (const ap of airports) {
      const k = airportMask(ap, x, z);
      h = lerp(h, ap.elev, k.m);
      const out = Math.abs(k.along) - ap.len / 2;
      if (out > 0 && out < 17000) {
        const capW = 1 - smoothstep(1500, 4500, Math.abs(k.lat));
        const capH = ap.elev + 15 + out * 0.027;
        if (h > capH) h = lerp(h, capH, capW);
      }
    }
    return h;
  }

  /* ---------- Texturen ---------- */
  function detailTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, 256, 256);
    const rnd = U.rng(7);
    for (let i = 0; i < 2600; i++) {
      const v = 190 + Math.floor(rnd() * 65);
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + rnd() * 0.5) + ')';
      const s = 2 + rnd() * 9;
      g.fillRect(rnd() * 256, rnd() * 256, s, s * (0.5 + rnd()));
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(120,125,115,' + (0.15 + rnd() * 0.3) + ')';
      g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function glowTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, inner || 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, inner || 'rgba(255,255,255,1)');
    gr.addColorStop(1, outer || 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function cloudTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const rnd = U.rng(99);
    for (let i = 0; i < 16; i++) {
      const x = 64 + (rnd() - 0.5) * 60, y = 68 + (rnd() - 0.5) * 34, r = 16 + rnd() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function runwayTexture(ap) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 4096;
    const g = c.getContext('2d');
    const L = ap.len, W = RW_MESH_W;
    g.scale(c.width / W, c.height / L); // ab hier Einheiten in Metern
    g.fillStyle = '#2f3237';
    g.fillRect(0, 0, W, L);
    const rnd = U.rng(ap.code.charCodeAt(0) * 31);
    for (let i = 0; i < 5000; i++) {
      const v = 40 + Math.floor(rnd() * 30);
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',0.5)';
      g.fillRect(rnd() * W, rnd() * L, 0.4 + rnd() * 2, 2 + rnd() * 14);
    }
    // Schultern
    g.fillStyle = 'rgba(70,72,70,0.55)';
    g.fillRect(0, 0, 7.5, L);
    g.fillRect(W - 7.5, 0, 7.5, L);
    // Gummiabrieb in den Aufsetzzonen
    for (const y0 of [150, L - 650]) {
      for (let i = 0; i < 160; i++) {
        g.fillStyle = 'rgba(15,15,16,' + (0.05 + rnd() * 0.1) + ')';
        g.fillRect(W / 2 - 9 + rnd() * 18 - 1, y0 + rnd() * 500, 0.6 + rnd() * 1.2, 20 + rnd() * 90);
      }
    }
    g.fillStyle = '#e9e9e4';
    // Randlinien
    g.fillRect(7.5, 0, 0.9, L);
    g.fillRect(W - 8.4, 0, 0.9, L);
    // Mittellinie
    for (let y = 110; y < L - 110; y += 50) g.fillRect(W / 2 - 0.45, y, 0.9, 30);
    const endMarks = (flip) => {
      g.save();
      if (flip) {
        g.translate(W, L);
        g.rotate(Math.PI);
      }
      // von y=L (Schwelle) nach innen (kleiner werdendes y)
      for (let i = 0; i < 6; i++) {
        g.fillRect(10.5 + i * 3.1, L - 36, 1.8, 30);
        g.fillRect(W - 12.3 - i * 3.1, L - 36, 1.8, 30);
      }
      g.fillRect(8, L - 3, W - 16, 1.5);
      // Bahnnummer
      const id = flip ? ap.ends[1].id : ap.ends[0].id;
      g.save();
      g.translate(W / 2, L - 48);
      g.scale(1, 2.6);
      g.font = 'bold 9px Arial, Helvetica, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(id, 0, 0);
      g.restore();
      // Zielpunkt-Markierung
      g.fillRect(W / 2 - 13, L - 345, 6, 45);
      g.fillRect(W / 2 + 7, L - 345, 6, 45);
      // Aufsetzzonen
      for (const d of [150, 450, 600]) {
        for (let k = 0; k < 3; k++) {
          g.fillRect(W / 2 - 15 + k * 2.6, L - d - 22, 1.5, 22);
          g.fillRect(W / 2 + 8.5 + k * 2.6, L - d - 22, 1.5, 22);
        }
      }
      g.restore();
    };
    endMarks(false);
    endMarks(true);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* ---------- Welt ---------- */
  const World = {
    SIZE, N, CELL, airports,
    heights: null, kinds: null,
    scene: null, weather: null,
    gates: [], gateMeshes: [],
    obstacles: [],
    lightningT: 8,

    init(scene, renderer) {
      this.scene = scene;
      this.maxAniso = renderer.capabilities.getMaxAnisotropy();
      this._buildTerrain();
      this._buildWater();
      this._buildSky();
      this._buildAirports();
      this._buildScenery();
      this._buildClouds();
      this._buildRoute();
    },

    /* --- Gelände --- */
    _buildTerrain() {
      const heights = (this.heights = new Float32Array(N * N));
      const kinds = (this.kinds = new Uint8Array(N * N));
      const pos = new Float32Array(N * N * 3);
      const col = new Float32Array(N * N * 3);
      const uv = new Float32Array(N * N * 2);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          heights[j * N + i] = terrainHeight(-HALF + i * CELL, -HALF + j * CELL);
        }
      }
      const C = (hex) => new THREE.Color(hex);
      const cSea = C(0x2a5870), cSand = C(0xd9c98e), cGrass = C(0x6f9f48), cForest = C(0x2f5f2c);
      const cRock = C(0x7b756b), cSnow = C(0xf2f5f8), cMow = C(0x78a551), cDry = C(0x9aa35a);
      const fields = [0x7fae4b, 0x9bbf5a, 0xcdbf62, 0x6a9a44, 0xa88f5c, 0x88b04f, 0xb9c36b, 0x5f9147].map(C);
      const tmp = new THREE.Color();
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const idx = j * N + i;
          const x = -HALF + i * CELL, z = -HALF + j * CELL;
          const h = heights[idx];
          const hl = heights[j * N + Math.max(0, i - 1)], hr = heights[j * N + Math.min(N - 1, i + 1)];
          const hu = heights[Math.max(0, j - 1) * N + i], hd = heights[Math.min(N - 1, j + 1) * N + i];
          const slope = Math.hypot(hr - hl, hd - hu) / (2 * CELL);
          let apM = 0;
          for (const ap of airports) apM = Math.max(apM, airportMask(ap, x, z).m);
          const fN = U.fbm(x / 1800 + 3, z / 1800 + 8, 3);
          let kind;
          if (h < 0.3) {
            kind = 0;
            tmp.copy(cSea);
          } else if (h < 4 && apM < 0.5) {
            kind = 1;
            tmp.copy(cSand);
          } else if (h > 1050 + (fN - 0.5) * 300) {
            kind = 5;
            tmp.copy(cSnow);
          } else if (slope > 0.42 || h > 820) {
            kind = 4;
            tmp.copy(cRock).lerp(cForest, clamp(0.5 - slope, 0, 0.3));
          } else if (apM > 0.6) {
            kind = 2;
            tmp.copy(cMow);
          } else if (fN > 0.53 || (slope > 0.2 && h > 120)) {
            kind = 3;
            tmp.copy(cForest).lerp(cGrass, clamp((0.6 - fN) * 2, 0, 0.35));
          } else {
            kind = 2;
            if (slope < 0.09 && h < 330) {
              const f = fields[Math.floor(U.hash2(Math.floor(x / 600), Math.floor(z / 600)) * fields.length)];
              tmp.copy(f);
            } else {
              tmp.copy(cGrass).lerp(cDry, clamp(h / 700, 0, 1));
            }
          }
          kinds[idx] = kind;
          const b = 0.9 + U.hash2(i * 3 + 1, j * 5 + 2) * 0.2;
          pos[idx * 3] = x;
          pos[idx * 3 + 1] = h;
          pos[idx * 3 + 2] = z;
          col[idx * 3] = tmp.r * b;
          col[idx * 3 + 1] = tmp.g * b;
          col[idx * 3 + 2] = tmp.b * b;
          uv[idx * 2] = x / 260;
          uv[idx * 2 + 1] = z / 260;
        }
      }
      const index = new Uint32Array((N - 1) * (N - 1) * 6);
      let k = 0;
      for (let j = 0; j < N - 1; j++) {
        for (let i = 0; i < N - 1; i++) {
          const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
          index[k++] = a; index[k++] = c; index[k++] = b;
          index[k++] = b; index[k++] = c; index[k++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeVertexNormals();
      this.detailTex = detailTexture();
      this.detailTex.anisotropy = this.maxAniso;
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: this.detailTex });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.terrain = mesh;
    },

    /** Geländehöhe (exakt wie das gerenderte Dreiecksnetz) */
    heightAt(x, z) {
      const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
      if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) return -60;
      const i = Math.floor(gx), j = Math.floor(gz);
      const fx = gx - i, fz = gz - j;
      const H = this.heights;
      const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
      if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
      return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
    },

    /** Untergrund-Art an einer Position */
    surfaceAt(x, z) {
      for (const ap of airports) {
        const dx = x - ap.x, dz = z - ap.z;
        const along = dx * ap.fx + dz * ap.fz;
        const lat = dx * ap.rx + dz * ap.rz;
        if (Math.abs(along) <= ap.len / 2 + 60 && Math.abs(lat) <= RW_MESH_W / 2) {
          return { type: 'runway', ap, along, lat, slope: 0 };
        }
        const sl = lat * ap.side;
        if (sl > 30 && sl < 430 && Math.abs(along) < ap.len / 2) {
          if ((sl > 128 && sl < 152) || (sl >= 152 && Math.abs(along) < 260) ||
            (sl <= 128 && (Math.abs(Math.abs(along) - (ap.len / 2 - 40)) < 14 || Math.abs(along) < 14))) {
            return { type: 'paved', ap, along, lat, slope: 0 };
          }
        }
        if (Math.abs(along) < ap.len / 2 + 900 && Math.abs(lat) < 700) return { type: 'grass', ap, along, lat, slope: 0 };
      }
      const h = this.heightAt(x, z);
      if (h < 0.2) return { type: 'water', slope: 0 };
      const e = 40;
      const slope = Math.hypot(this.heightAt(x + e, z) - this.heightAt(x - e, z), this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
      const gi = clamp(Math.round((x + HALF) / CELL), 0, N - 1), gj = clamp(Math.round((z + HALF) / CELL), 0, N - 1);
      const kind = this.kinds[gj * N + gi];
      const type = kind === 3 ? 'forest' : kind >= 4 ? 'rock' : 'grass';
      return { type, slope };
    },

    _buildWater() {
      const tex = this.detailTex.clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(700, 700);
      const mat = new THREE.MeshPhongMaterial({ color: 0x1d5e8c, map: tex, specular: 0x8899aa, shininess: 40 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(420000, 420000), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0;
      this.scene.add(m);
      this.water = m;
    },

    _buildSky() {
      const geo = new THREE.SphereGeometry(70000, 32, 16);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
      this.sky = new THREE.Mesh(geo, mat);
      this.sky.renderOrder = -10;
      this.sky.frustumCulled = false;
      this.scene.add(this.sky);

      this.hemi = new THREE.HemisphereLight(0xffffff, 0x666655, 1.5);
      this.scene.add(this.hemi);
      this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
      this.scene.add(this.sunLight);
      this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,250,225,1)', 'rgba(255,240,190,0)'), fog: false, depthWrite: false,
        transparent: true, blending: THREE.AdditiveBlending,
      }));
      this.sunSprite.scale.set(11000, 11000, 1);
      this.sunSprite.renderOrder = -9;
      this.scene.add(this.sunSprite);
      this.scene.fog = new THREE.Fog(0xbfd9ee, 5000, 45000);
    },

    /* --- Flughäfen --- */
    _buildAirports() {
      const glow = glowTexture();
      this.lightMats = [];
      this.papi = [];
      const lightPos = [], lightCol = [];
      const papiPos = [], papiCol = [];
      const pushL = (ap, lx, lz, ly, r, g, b) => {
        lightPos.push(ap.x + lx * ap.rx - lz * ap.fx, ap.elev + ly, ap.z + lx * ap.rz - lz * ap.fz);
        lightCol.push(r, g, b);
      };
      const matPaved = new THREE.MeshLambertMaterial({ color: 0x55585c, map: this.detailTex, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      const matBld = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
      const matBld2 = new THREE.MeshLambertMaterial({ color: 0x8e9aa6 });
      const matGlass = new THREE.MeshLambertMaterial({ color: 0x33506b, emissive: 0x0a1a2a });
      const matRoof = new THREE.MeshLambertMaterial({ color: 0x9c4a3a });

      for (const ap of airports) {
        const grp = new THREE.Group();
        grp.position.set(ap.x, ap.elev, ap.z);
        grp.rotation.y = -ap.hdg;
        this.scene.add(grp);
        ap.group = grp;
        const L = ap.len, s = ap.side;

        const tex = runwayTexture(ap);
        tex.anisotropy = this.maxAniso;
        const rw = new THREE.Mesh(new THREE.PlaneGeometry(RW_MESH_W, L), new THREE.MeshLambertMaterial({
          map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10,
        }));
        rw.rotation.x = -Math.PI / 2;
        rw.position.y = 0.14;
        grp.add(rw);

        const paved = (x0, x1, z0, z1) => {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), matPaved);
          m.rotation.x = -Math.PI / 2;
          m.position.set((x0 + x1) / 2, 0.1, (z0 + z1) / 2);
          grp.add(m);
        };
        paved(s * 128, s * 152, -L / 2, L / 2); // Rollweg
        paved(s * 30, s * 128, -L / 2 + 26, -L / 2 + 54);
        paved(s * 30, s * 128, L / 2 - 54, L / 2 - 26);
        paved(s * 30, s * 128, -14, 14);
        paved(s * 152, s * 430, -260, 260); // Vorfeld

        const box = (w, h, d, x, z, mat, y0) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          m.position.set(x, (y0 || 0) + h / 2, z);
          grp.add(m);
          if (!y0) this.obstacles.push({ ap, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
          return m;
        };
        box(46, 15, 190, s * 395, -30, matBld); // Terminal
        box(47, 5, 191, s * 395, -30, matGlass, 4);
        box(50, 1.5, 196, s * 395, -30, matBld2, 15);
        for (let i = 0; i < 3; i++) {
          box(56, 17, 52, s * 385, 135 + i * 62 - 20, matBld2); // Hangars
        }
        const tw = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.2, 34, 12), matBld);
        tw.position.set(s * 330, 17, -215);
        grp.add(tw);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 6.2, 6.5, 12), matGlass);
        cab.position.set(s * 330, 37, -215);
        grp.add(cab);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 1.2, 12), matRoof);
        cap.position.set(s * 330, 40.8, -215);
        grp.add(cap);
        this.obstacles.push({ ap, x0: s * 330 - 8, x1: s * 330 + 8, z0: -223, z1: -207, h: 42 });

        // Befeuerung
        for (let z = -L / 2; z <= L / 2 + 1; z += 60) {
          pushL(ap, -23.5, z, 0.6, 1, 0.97, 0.85);
          pushL(ap, 23.5, z, 0.6, 1, 0.97, 0.85);
        }
        for (let z = -L / 2 + 30; z < L / 2; z += 30) pushL(ap, 0, z, 0.3, 0.75, 0.75, 0.7);
        for (const e of [1, -1]) {
          const zt = e * (L / 2 + 3);
          for (let x = -21; x <= 21; x += 3.5) pushL(ap, x, zt, 0.6, 0.15, 1, 0.3);
          for (let d = 30; d <= 450; d += 30) {
            pushL(ap, 0, e * (L / 2 + d), 1.2, 1, 1, 0.92);
            if (d <= 150) {
              pushL(ap, -1.5, e * (L / 2 + d), 1.2, 1, 1, 0.92);
              pushL(ap, 1.5, e * (L / 2 + d), 1.2, 1, 1, 0.92);
            }
          }
          for (let x = -15; x <= 15; x += 3) pushL(ap, x, e * (L / 2 + 300), 1.2, 1, 1, 0.92);
        }
        // PAPI je Landerichtung (links der Bahn, 300 m hinter der Schwelle)
        for (const end of ap.ends) {
          const p = { end, idx: papiPos.length / 3 };
          for (let i = 0; i < 4; i++) {
            const lat = -(52 - i * 8);
            papiPos.push(end.aim.x + end.rx * lat, ap.elev + 1.2, end.aim.z + end.rz * lat);
            papiCol.push(1, 1, 1);
          }
          this.papi.push(p);
        }
      }

      const mkPoints = (posArr, colArr, size, minPx) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colArr), 3));
        const mat = new THREE.PointsMaterial({
          size, map: glow, vertexColors: true, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, sizeAttenuation: true,
        });
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>',
            'gl_PointSize = max(gl_PointSize, ' + minPx.toFixed(1) + ');\n#include <fog_vertex>');
        };
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        this.scene.add(pts);
        this.lightMats.push(mat);
        return pts;
      };
      this.rwLights = mkPoints(lightPos, lightCol, 3.2, 2.2);
      this.papiPts = mkPoints(papiPos, papiCol, 6, 3.6);
    },

    /* --- Bäume & Gebäude --- */
    _buildScenery() {
      const rnd = U.rng(4242);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      const col = new THREE.Color();
      const up = new THREE.Vector3(0, 1, 0);

      // Bäume
      const NT = 5200;
      const cone = new THREE.ConeGeometry(5.5, 17, 6);
      cone.translate(0, 8.5, 0);
      const trees = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
      const centers = [];
      for (const ap of airports) centers.push({ x: ap.x, z: ap.z, r: 7500 });
      centers.push({ x: -6500, z: 6000, r: 5000 }, { x: -1500, z: 4500, r: 5000 }, { x: 3800, z: 3400, r: 5000 }, { x: 7300, z: -2700, r: 5500 });
      let n = 0, guard = 0;
      while (n < NT && guard++ < NT * 30) {
        const c = centers[Math.floor(rnd() * centers.length)];
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * c.r;
        const x = c.x + Math.cos(ang) * rr, z = c.z + Math.sin(ang) * rr;
        const s = this.surfaceAt(x, z);
        if (s.ap || s.type === 'water' || s.type === 'rock') continue;
        let apM = 0;
        for (const ap of airports) apM = Math.max(apM, airportMask(ap, x, z).m);
        if (s.type === 'grass') {
          // Baumreihen / Feldgehölze
          const hedge = U.noise2(x / 140, z / 140) > 0.72;
          if (!hedge || apM > 0.93) continue;
        }
        const h = this.heightAt(x, z);
        if (h < 3) continue;
        const k = 0.7 + rnd() * 0.9;
        p.set(x, h - 0.5, z);
        q.setFromAxisAngle(up, rnd() * 6.28);
        sc.set(k * (0.8 + rnd() * 0.5), k, k * (0.8 + rnd() * 0.5));
        m4.compose(p, q, sc);
        trees.setMatrixAt(n, m4);
        col.setHSL(0.27 + rnd() * 0.09, 0.45 + rnd() * 0.2, 0.17 + rnd() * 0.1);
        trees.setColorAt(n, col);
        n++;
      }
      trees.count = n;
      trees.instanceMatrix.needsUpdate = true;
      if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
      trees.frustumCulled = false;
      this.scene.add(trees);

      // Ortschaften
      const towns = [
        { x: 7400, z: -5600, r: 1100, n: 260 },
        { x: -9800, z: 8300, r: 800, n: 150 },
        { x: -1800, z: 6300, r: 600, n: 90 },
      ];
      const total = towns.reduce((a, t) => a + t.n, 0);
      const bgeo = new THREE.BoxGeometry(1, 1, 1);
      bgeo.translate(0, 0.5, 0);
      const bld = new THREE.InstancedMesh(bgeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), total);
      const pal = [0xe8e2d4, 0xd9cdb8, 0xf2efe8, 0xc9b9a0, 0xb5544a, 0xa8b0b8, 0xdedede];
      n = 0;
      for (const t of towns) {
        let made = 0;
        guard = 0;
        while (made < t.n && guard++ < t.n * 20) {
          const x = t.x + U.randn() * t.r * 0.55 * 1, z = t.z + U.randn() * t.r * 0.55;
          const sx = Math.round(x / 46) * 46 + (rnd() - 0.5) * 8, sz = Math.round(z / 46) * 46 + (rnd() - 0.5) * 8;
          const s = this.surfaceAt(sx, sz);
          if (s.ap || s.type === 'water' || s.slope > 0.12) continue;
          const dist = Math.hypot(sx - t.x, sz - t.z) / t.r;
          const hgt = 7 + rnd() * 10 + (dist < 0.35 ? rnd() * 28 : 0);
          p.set(sx, this.heightAt(sx, sz) - 1, sz);
          q.setFromAxisAngle(up, (Math.floor(rnd() * 2) * Math.PI) / 2 + 0.2);
          sc.set(12 + rnd() * 22, hgt, 12 + rnd() * 18);
          m4.compose(p, q, sc);
          bld.setMatrixAt(n, m4);
          col.set(pal[Math.floor(rnd() * pal.length)]);
          bld.setColorAt(n, col);
          n++;
          made++;
        }
      }
      bld.count = n;
      bld.instanceMatrix.needsUpdate = true;
      if (bld.instanceColor) bld.instanceColor.needsUpdate = true;
      bld.frustumCulled = false;
      this.scene.add(bld);
    },

    /* --- Wolken --- */
    _buildClouds() {
      this.cloudTex = cloudTexture();
      this.cloudMat = new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, opacity: 0.9, color: 0xffffff });
      this.cloudGroup = new THREE.Group();
      this.scene.add(this.cloudGroup);
    },

    _makeClouds(count, base, top, scale, perCloud) {
      const g = this.cloudGroup;
      while (g.children.length) g.remove(g.children[0]);
      const rnd = U.rng(1234 + count);
      for (let i = 0; i < count; i++) {
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 30000;
        const cx = Math.cos(ang) * rr, cz = Math.sin(ang) * rr, cy = base + rnd() * (top - base);
        const big = 0.7 + rnd() * 0.9;
        for (let k = 0; k < perCloud; k++) {
          const s = new THREE.Sprite(this.cloudMat);
          const sz = scale * big * (0.6 + rnd() * 0.7);
          s.scale.set(sz, sz * 0.55, 1);
          s.position.set(cx + (rnd() - 0.5) * scale * big * 1.3, cy + (rnd() - 0.5) * scale * 0.16, cz + (rnd() - 0.5) * scale * big * 1.3);
          g.add(s);
        }
      }
    },

    /* --- Wetter --- */
    setWeather(name) {
      const W = {
        clear: {
          top: 0x2466c2, hor: 0xb9d6ee, fogNear: 7000, fogFar: 52000, sun: [0.45, 0.72, 0.35], sunCol: 0xfff4e0, sunInt: 3.0,
          hemiSky: 0xcfe4ff, hemiGnd: 0x6b6a55, hemiInt: 1.55, clouds: 16, cBase: 1500, cTop: 2300, cScale: 1500, cPer: 5,
          cloudCol: 0xffffff, cloudOp: 0.92, water: 0x1d5e8c, windDir: 95, windSpd: 1.5, turb: 0.12, rain: 0, lights: 0.55, lightning: false, sunVis: 1,
        },
        cloudy: {
          top: 0x3a6aa8, hor: 0xc3cfd8, fogNear: 4500, fogFar: 34000, sun: [-0.5, 0.5, 0.45], sunCol: 0xffe9c8, sunInt: 2.4,
          hemiSky: 0xd4dde8, hemiGnd: 0x66665a, hemiInt: 1.5, clouds: 46, cBase: 1250, cTop: 2400, cScale: 1900, cPer: 6,
          cloudCol: 0xf2f4f6, cloudOp: 0.9, water: 0x285d7e, windDir: 60, windSpd: 5, turb: 0.7, rain: 0, lights: 0.75, lightning: false, sunVis: 0.8,
        },
        storm: {
          top: 0x1b222c, hor: 0x56606a, fogNear: 500, fogFar: 12500, sun: [-0.7, 0.28, 0.3], sunCol: 0xaab4c4, sunInt: 0.75,
          hemiSky: 0x7c8794, hemiGnd: 0x33352f, hemiInt: 0.85, clouds: 64, cBase: 1150, cTop: 1900, cScale: 2600, cPer: 6,
          cloudCol: 0x4a525c, cloudOp: 0.95, water: 0x23323d, windDir: 75, windSpd: 10, turb: 2.0, rain: 1, lights: 1, lightning: true, sunVis: 0,
        },
      }[name];
      this.weather = W;
      W.name = name;
      const top = new THREE.Color(W.top), hor = new THREE.Color(W.hor), c = new THREE.Color();
      const posA = this.sky.geometry.attributes.position, colA = this.sky.geometry.attributes.color;
      for (let i = 0; i < posA.count; i++) {
        const t = clamp(posA.getY(i) / 70000, 0, 1);
        c.copy(hor).lerp(top, Math.pow(t, 0.55));
        colA.setXYZ(i, c.r, c.g, c.b);
      }
      colA.needsUpdate = true;
      this.scene.fog.color.copy(hor);
      this.scene.fog.near = W.fogNear;
      this.scene.fog.far = W.fogFar;
      this.hemi.color.set(W.hemiSky);
      this.hemi.groundColor.set(W.hemiGnd);
      this.hemi.intensity = W.hemiInt;
      this.baseHemi = W.hemiInt;
      this.sunDir = new THREE.Vector3(W.sun[0], W.sun[1], W.sun[2]).normalize();
      this.sunLight.position.copy(this.sunDir);
      this.sunLight.color.set(W.sunCol);
      this.sunLight.intensity = W.sunInt;
      this.sunSprite.material.opacity = W.sunVis;
      this.sunSprite.visible = W.sunVis > 0;
      this.water.material.color.set(W.water);
      this.cloudMat.color.set(W.cloudCol);
      this.cloudMat.opacity = W.cloudOp;
      this._makeClouds(W.clouds, W.cBase, W.cTop, W.cScale, W.cPer);
      for (const m of this.lightMats) m.opacity = W.lights;
      // Windvektor (Luftbewegung), Wind kommt AUS windDir
      const wd = W.windDir * RAD;
      this.wind = new THREE.Vector3(-Math.sin(wd) * W.windSpd, 0, Math.cos(wd) * W.windSpd);
      this.lightningT = 5 + Math.random() * 6;
      this.flash = 0;
    },

    /* --- Route & Tore --- */
    _buildRoute() {
      const A = airports[0], B = airports[1];
      const eB = B.ends[0];
      const g = [];
      const farA = { x: A.x + A.fx * A.len / 2, z: A.z + A.fz * A.len / 2 };
      const add = (x, z, alt, tag) => g.push({ x, z, y: alt, tag: tag || '' });
      add(farA.x + A.fx * 2200, farA.z + A.fz * 2200, A.elev + 330, 'climb');
      add(farA.x + A.fx * 4700, farA.z + A.fz * 4700, A.elev + 640, 'climb');
      add(farA.x + A.fx * 6900, farA.z + A.fz * 6900, 900, 'cruise');
      const P = { x: eB.thr.x - eB.fx * 13200, z: eB.thr.z - eB.fz * 13200 };
      const last = g[g.length - 1];
      add(lerp(last.x, P.x, 0.36), lerp(last.z, P.z, 0.36), 900, 'cruise');
      add(lerp(last.x, P.x, 0.7), lerp(last.z, P.z, 0.7), 900, 'cruise');
      add(P.x, P.z, B.elev + 13500 * GS_TAN + 30, 'turn');
      for (const d of [11000, 9000, 7000, 5000, 3500, 2200, 1200]) {
        add(eB.thr.x - eB.fx * d, eB.thr.z - eB.fz * d, B.elev + (d + 300) * GS_TAN, 'final');
      }
      // Flugrichtung an jedem Tor
      for (let i = 0; i < g.length; i++) {
        const a = g[Math.max(0, i - 1)], b = g[Math.min(g.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        if (g[i].tag === 'final') {
          dx = eB.fx;
          dz = eB.fz;
        }
        const l = Math.hypot(dx, dz) || 1;
        g[i].dx = dx / l;
        g[i].dz = dz / l;
      }
      this.gates = g;
      this.dep = A.ends[0];
      this.dest = eB;
      const geo = new THREE.TorusGeometry(95, 4.5, 8, 40);
      this.gateMatNext = new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.95, fog: false });
      this.gateMatFar = new THREE.MeshBasicMaterial({ color: 0x38c8ff, transparent: true, opacity: 0.45, fog: false });
      this.gateMeshes = g.map((gt) => {
        const m = new THREE.Mesh(geo, this.gateMatFar);
        m.position.set(gt.x, gt.y, gt.z);
        m.lookAt(gt.x + gt.dx, gt.y, gt.z + gt.dz);
        m.visible = false;
        this.scene.add(m);
        return m;
      });
    },

    showGates(nextIdx, enabled) {
      for (let i = 0; i < this.gateMeshes.length; i++) {
        const m = this.gateMeshes[i];
        m.visible = enabled && i >= nextIdx && i < nextIdx + 3;
        m.material = i === nextIdx ? this.gateMatNext : this.gateMatFar;
      }
    },

    /** ILS-Daten zur am besten passenden Landebahn */
    ilsFor(pos, preferDest, hdg) {
      let best = null, bestScore = 1e12;
      for (const ap of airports) {
        for (const e of ap.ends) {
          if (hdg != null && Math.abs(U.wrapPi(e.hdg - hdg)) > 1.75) continue;
          const dx = pos.x - e.aim.x, dz = pos.z - e.aim.z;
          const dist = -(dx * e.fx + dz * e.fz);
          const lat = dx * e.rx + dz * e.rz;
          if (dist < -(ap.len - 250) || dist > 30000) continue;
          const locDeg = Math.atan2(lat, dist + ap.len) * DEG;
          if (Math.abs(locDeg) > 40) continue;
          let score = Math.abs(dist) + Math.abs(lat) * 2;
          if (e === preferDest) score -= 6000;
          if (score < bestScore) {
            bestScore = score;
            const hAbove = pos.y - 2.2 - ap.elev;
            const gsDeg = Math.atan2(hAbove, Math.max(dist, 1)) * DEG;
            best = { end: e, ap, dist, lat, loc: locDeg, gs: gsDeg - 3, gsValid: dist > 150, thrDist: dist - 300 };
          }
        }
      }
      return best;
    },

    obstacleHit(pos) {
      for (const o of this.obstacles) {
        const ap = o.ap;
        if (pos.y - ap.elev > o.h + 1) continue;
        const dx = pos.x - ap.x, dz = pos.z - ap.z;
        const lx = dx * ap.rx + dz * ap.rz; // lokal rechts
        const lz = -(dx * ap.fx + dz * ap.fz); // lokal +Z (rückwärts)
        if (lx > o.x0 - 6 && lx < o.x1 + 6 && lz > o.z0 - 6 && lz < o.z1 + 6) return true;
      }
      return false;
    },

    /** pro Frame: Himmel mitführen, PAPI, Blitze. Gibt Ereignisse zurück. */
    update(dt, camPos, acPos) {
      const ev = {};
      this.sky.position.copy(camPos);
      this.sunSprite.position.copy(camPos).addScaledVector(this.sunDir, 60000);
      // PAPI
      const colA = this.papiPts.geometry.attributes.color;
      const th = [2.5, 2.83, 3.17, 3.5];
      for (const p of this.papi) {
        const e = p.end;
        const dx = acPos.x - e.aim.x, dz = acPos.z - e.aim.z;
        const dist = -(dx * e.fx + dz * e.fz);
        const ang = dist > 5 ? Math.atan2(acPos.y - e.ap.elev, dist) * DEG : 3;
        for (let i = 0; i < 4; i++) {
          if (dist < -150) colA.setXYZ(p.idx + i, 0, 0, 0); // von hinten nicht sichtbar
          else if (ang > th[i]) colA.setXYZ(p.idx + i, 1, 1, 1);
          else colA.setXYZ(p.idx + i, 1, 0.04, 0.02);
        }
      }
      colA.needsUpdate = true;
      // Blitze
      if (this.weather && this.weather.lightning) {
        this.lightningT -= dt;
        if (this.lightningT <= 0) {
          this.lightningT = 7 + Math.random() * 12;
          this.flash = 1;
          ev.lightning = 0.6 + Math.random() * 2.2; // Donner-Verzögerung
        }
      }
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 3.2);
        const f = this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40));
        this.hemi.intensity = this.baseHemi + f * 5;
      } else if (this.hemi.intensity !== this.baseHemi) {
        this.hemi.intensity = this.baseHemi;
      }
      return ev;
    },
  };

  FS.World = World;
})();
