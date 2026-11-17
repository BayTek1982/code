/* Flugsimulator – Instrumente: Hauptfluganzeige (PFD), Navigation (ND), Triebwerke/Systeme */
(function () {
  'use strict';
  const FS = window.FS;
  const U = FS.U;
  const { clamp, DEG, RAD, KT, FT } = U;

  const FONT = "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
  const COL = { r: '#ff4038', a: '#ffb020', g: '#3ddc6a', w: '#e8eef4', mag: '#ff5cf0', cyan: '#42d4ff' };

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function txt(g, s, x, y, size, color, align, font, weight) {
    g.font = (weight || '600') + ' ' + size + 'px ' + (font || FONT);
    g.fillStyle = color || COL.w;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }

  /** virtuelle Zeichenfläche (vw x vh) zentriert einpassen */
  function fit(g, W, H, vw, vh) {
    const s = Math.min(W / vw, H / vh);
    g.translate((W - vw * s) / 2, (H - vh * s) / 2);
    g.scale(s, s);
    return s;
  }

  /* ================= PFD ================= */
  function drawAttitude(g, cx, cy, w, h, pitch, bank, ppd) {
    g.save();
    rr(g, cx - w / 2, cy - h / 2, w, h, 8);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-bank);
    g.translate(0, pitch * DEG * ppd);
    g.fillStyle = '#2b7fd6';
    g.fillRect(-500, -900, 1000, 900);
    g.fillStyle = '#7d5226';
    g.fillRect(-500, 0, 1000, 900);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-500, 0);
    g.lineTo(500, 0);
    g.stroke();
    g.lineWidth = 1.2;
    for (let d = -80; d <= 80; d += 5) {
      if (d === 0) continue;
      const y = -d * ppd, half = d % 10 === 0 ? 24 : 11;
      g.beginPath();
      g.moveTo(-half, y);
      g.lineTo(half, y);
      g.stroke();
      if (d % 10 === 0) {
        txt(g, String(Math.abs(d)), -half - 4, y, 9, '#fff', 'right', MONO);
        txt(g, String(Math.abs(d)), half + 4, y, 9, '#fff', 'left', MONO);
      }
    }
    g.restore();
  }

  function drawPFD(g, W, H, st) {
    const ac = st.ac;
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, W, H);
    g.save();
    fit(g, W, H, 300, 250);
    if (!st.pfdOn) {
      drawStandby(g, st);
      g.restore();
      return;
    }
    const cx = 150, cy = 115, ppd = 3.3;
    drawAttitude(g, cx, cy, 160, 170, ac.pitch, ac.bank, ppd);

    // Querneigungsskala
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.4;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r0 = 76, r1 = a % 30 === 0 ? 84 : 80, t = (a - 90) * RAD;
      g.beginPath();
      g.moveTo(Math.cos(t) * r0, Math.sin(t) * r0);
      g.lineTo(Math.cos(t) * r1, Math.sin(t) * r1);
      g.stroke();
    }
    g.rotate(-ac.bank);
    g.fillStyle = Math.abs(ac.bank) > 40 * RAD ? COL.a : '#fff';
    g.beginPath();
    g.moveTo(0, -75);
    g.lineTo(-6, -64);
    g.lineTo(6, -64);
    g.closePath();
    g.fill();
    g.restore();

    // Flugzeugsymbol
    g.strokeStyle = '#111';
    g.lineWidth = 5;
    const sym = () => {
      g.beginPath();
      g.moveTo(cx - 52, cy);
      g.lineTo(cx - 20, cy);
      g.lineTo(cx - 20, cy + 7);
      g.moveTo(cx + 52, cy);
      g.lineTo(cx + 20, cy);
      g.lineTo(cx + 20, cy + 7);
      g.stroke();
    };
    sym();
    g.strokeStyle = '#ffd92e';
    g.lineWidth = 3;
    sym();
    g.fillStyle = '#ffd92e';
    g.fillRect(cx - 2.5, cy - 2.5, 5, 5);

    // ILS
    const ils = st.ils;
    if (ils) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(cx - 52, 187, 104, 11);
      g.fillRect(218, cy - 52, 11, 104);
      g.fillStyle = '#fff';
      for (let i = -2; i <= 2; i++) {
        if (i === 0) {
          g.fillRect(cx - 0.8, 188, 1.6, 9);
          g.fillRect(219, cy - 0.8, 9, 1.6);
          continue;
        }
        g.beginPath();
        g.arc(cx + i * 22, 192.5, 1.8, 0, 7);
        g.fill();
        g.beginPath();
        g.arc(223.5, cy + i * 22, 1.8, 0, 7);
        g.fill();
      }
      const dia = (x, y) => {
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + 5, y);
        g.lineTo(x, y + 5);
        g.lineTo(x - 5, y);
        g.closePath();
        g.fill();
      };
      g.fillStyle = COL.mag;
      dia(cx - clamp(ils.loc / 2.5, -1, 1) * 44, 192.5);
      if (ils.gsValid) dia(223.5, cy + clamp(ils.gs / 0.7, -1, 1) * 44);
      txt(g, 'ILS ' + ils.end.id + ' ' + ils.ap.code + '  ' + Math.max(0, ils.thrDist / 1000).toFixed(1) + ' km', 70, 14, 10.5, COL.mag);
    } else txt(g, 'KEIN ILS-SIGNAL', 70, 14, 9.5, '#6f7b88');
    if (!ac.sys.elec) txt(g, 'FLUGSCHUTZ AUS', 230, 14, 9.5, COL.a, 'right');

    // Funkhöhe
    const raFt = ac.ra * FT;
    if (raFt < 2500 && !ac.onGround) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(cx - 24, 168, 48, 15);
      txt(g, 'RA ' + Math.max(0, Math.round(raFt / (raFt < 100 ? 1 : 10)) * (raFt < 100 ? 1 : 10)), cx, 176, 11, raFt < 400 ? COL.a : COL.g, 'center', MONO);
    }

    // --- Fahrtmesser
    const ias = st.iasDisp;
    g.save();
    rr(g, 8, 30, 52, 170, 5);
    g.clip();
    g.fillStyle = '#1a222c';
    g.fillRect(8, 30, 52, 170);
    const ppk = 1.55;
    const yS = (v) => cy - (v - ias) * ppk;
    const vs = ac.stallSpeed() * KT;
    g.fillStyle = COL.r;
    g.fillRect(53, yS(vs), 7, 400);
    g.fillStyle = COL.a;
    g.fillRect(53, yS(vs * 1.18), 7, yS(vs) - yS(vs * 1.18));
    g.fillStyle = COL.r;
    for (let v = 292; v < 420; v += 6) g.fillRect(53, yS(v + 3), 7, 3 * ppk);
    g.strokeStyle = '#cfd8e0';
    g.lineWidth = 1;
    const v0 = Math.floor((ias - 65) / 10) * 10;
    for (let v = Math.max(0, v0); v <= ias + 65; v += 10) {
      const y = yS(v);
      g.beginPath();
      g.moveTo(46, y);
      g.lineTo(53, y);
      g.stroke();
      if (v % 20 === 0) txt(g, String(v), 43, y, 10.5, '#cfd8e0', 'right', MONO);
    }
    g.restore();
    g.fillStyle = '#000';
    g.strokeStyle = st.pitotOK ? '#fff' : COL.r;
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(8, cy - 11);
    g.lineTo(48, cy - 11);
    g.lineTo(55, cy);
    g.lineTo(48, cy + 11);
    g.lineTo(8, cy + 11);
    g.closePath();
    g.fill();
    g.stroke();
    txt(g, String(Math.round(ias)), 44, cy + 0.5, 15, st.pitotOK ? '#fff' : COL.r, 'right', MONO, '700');
    txt(g, 'KT', 34, 22, 9, '#8fa0b0', 'center');
    if (!st.pitotOK) {
      g.fillStyle = COL.r;
      g.fillRect(12, 180, 44, 14);
      txt(g, 'DEFEKT', 34, 187.5, 9, '#fff', 'center');
    }

    // --- Höhenmesser
    const alt = ac.pos.y * FT;
    g.save();
    rr(g, 240, 30, 46, 170, 5);
    g.clip();
    g.fillStyle = '#1a222c';
    g.fillRect(240, 30, 46, 170);
    const ppf = 0.085;
    const yA = (a) => cy - (a - alt) * ppf;
    const gnd = (ac.pos.y - ac.ra - FS.Aircraft.GEAR_H) * FT;
    g.fillStyle = '#6b4a22';
    g.fillRect(240, yA(gnd), 46, 400);
    g.strokeStyle = '#cfd8e0';
    const a0 = Math.floor((alt - 1100) / 100) * 100;
    for (let a = a0; a <= alt + 1100; a += 100) {
      const y = yA(a);
      g.beginPath();
      g.moveTo(240, y);
      g.lineTo(a % 500 === 0 ? 249 : 245, y);
      g.stroke();
      if (a % 500 === 0) txt(g, String(a), 283, y, 10, '#cfd8e0', 'right', MONO);
    }
    g.restore();
    g.fillStyle = '#000';
    g.strokeStyle = '#fff';
    g.beginPath();
    g.moveTo(286, cy - 11);
    g.lineTo(247, cy - 11);
    g.lineTo(241, cy);
    g.lineTo(247, cy + 11);
    g.lineTo(286, cy + 11);
    g.closePath();
    g.fill();
    g.stroke();
    txt(g, String(Math.round(alt / 10) * 10), 284, cy + 0.5, 13.5, '#fff', 'right', MONO, '700');
    txt(g, 'FT', 263, 22, 9, '#8fa0b0', 'center');

    // --- Variometer
    const fpm = ac.vs * FT * 60;
    g.fillStyle = '#1a222c';
    g.fillRect(289, 60, 9, 110);
    const vy = clamp(fpm / 2500, -1, 1) * 53;
    g.fillStyle = fpm < -1100 && raFt < 1500 ? COL.a : COL.g;
    g.fillRect(289, vy > 0 ? cy - vy : cy, 9, Math.abs(vy));
    g.fillStyle = '#fff';
    g.fillRect(288, cy - 0.6, 11, 1.2);
    if (Math.abs(fpm) > 150) txt(g, (fpm > 0 ? '+' : '-') + Math.round(Math.abs(fpm) / 100), 293.5, fpm > 0 ? 52 : 178, 9, '#cfd8e0', 'center', MONO);

    // --- Kursband
    const hdg = ac.hdg * DEG;
    g.save();
    rr(g, 70, 208, 160, 34, 5);
    g.clip();
    g.fillStyle = '#1a222c';
    g.fillRect(70, 208, 160, 34);
    const pph = 2.6;
    g.strokeStyle = '#cfd8e0';
    const h0 = Math.floor((hdg - 35) / 5) * 5;
    for (let d = h0; d <= hdg + 35; d += 5) {
      const x = cx + (d - hdg) * pph;
      const dd = U.wrap360(d);
      g.beginPath();
      g.moveTo(x, 208);
      g.lineTo(x, dd % 10 === 0 ? 216 : 212);
      g.stroke();
      if (dd % 10 === 0) {
        const lab = dd === 0 ? 'N' : dd === 90 ? 'O' : dd === 180 ? 'S' : dd === 270 ? 'W' : U.pad(dd / 10, 2);
        if (dd % 90 === 0) txt(g, lab, x, 226, 13, COL.cyan, 'center', FONT, '800');
        else txt(g, lab, x, 226, 10.5, '#cfd8e0', 'center', MONO);
      }
    }
    if (st.wpBrg != null) {
      const diff = U.wrapPi(st.wpBrg - ac.hdg) * DEG;
      const x = cx + clamp(diff, -30, 30) * pph;
      g.fillStyle = COL.mag;
      g.beginPath();
      g.moveTo(x, 208);
      g.lineTo(x - 6, 219);
      g.lineTo(x + 6, 219);
      g.closePath();
      g.fill();
    }
    g.restore();
    g.fillStyle = '#ffd92e';
    g.beginPath();
    g.moveTo(cx, 211);
    g.lineTo(cx - 5, 203);
    g.lineTo(cx + 5, 203);
    g.closePath();
    g.fill();
    txt(g, U.pad(U.wrap360(Math.round(hdg)) % 360, 3) + '°', 236, 225, 12, '#fff', 'left', MONO, '700');
    txt(g, 'KURS', 64, 225, 8.5, '#8fa0b0', 'right');

    // --- Warntexte
    const big = (s, color) => {
      if (!st.blink) return;
      g.fillStyle = color;
      rr(g, cx - 58, 136, 116, 24, 4);
      g.fill();
      txt(g, s, cx, 148.5, 14, '#fff', 'center', FONT, '800');
    };
    if (st.warn.pullUp) big('HOCHZIEHEN!', COL.r);
    else if (st.warn.stall) big('ÜBERZOGEN!', COL.r);
    else if (st.warn.sinkRate) big('SINKRATE', '#c27a00');
    g.restore();
  }

  function drawStandby(g, st) {
    const ac = st.ac;
    txt(g, 'KEIN STROM', 150, 20, 13, '#59636e', 'center');
    txt(g, 'NOTINSTRUMENT', 150, 238, 9, '#59636e', 'center');
    const cx = 150, cy = 122, r = 62;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-ac.bank);
    g.translate(0, ac.pitch * DEG * 2.4);
    g.fillStyle = '#1f5fa3';
    g.fillRect(-300, -600, 600, 600);
    g.fillStyle = '#5d3d1c';
    g.fillRect(-300, 0, 600, 600);
    g.strokeStyle = '#ddd';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-300, 0);
    g.lineTo(300, 0);
    for (let d = -30; d <= 30; d += 10) {
      if (!d) continue;
      g.moveTo(-14, -d * 2.4);
      g.lineTo(14, -d * 2.4);
    }
    g.stroke();
    g.restore();
    g.strokeStyle = '#444c55';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, 0, 7);
    g.stroke();
    g.strokeStyle = '#ffb020';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - 34, cy);
    g.lineTo(cx - 12, cy);
    g.moveTo(cx + 12, cy);
    g.lineTo(cx + 34, cy);
    g.stroke();
    g.fillStyle = '#ffb020';
    g.fillRect(cx - 2, cy - 2, 4, 4);
    txt(g, 'KT', 44, 96, 9, '#8a7a50', 'center');
    txt(g, String(Math.round(st.iasDisp)), 44, 122, 22, st.pitotOK ? '#ffb020' : COL.r, 'center', MONO, '700');
    txt(g, 'FT', 256, 96, 9, '#8a7a50', 'center');
    txt(g, String(Math.round((ac.pos.y * FT) / 10) * 10), 256, 122, 19, '#ffb020', 'center', MONO, '700');
    txt(g, 'KURS ' + U.pad(U.wrap360(Math.round(ac.hdg * DEG)) % 360, 3) + '°', 150, 206, 12, '#ffb020', 'center', MONO, '700');
  }

  /* ================= Navigationsdisplay ================= */
  function drawND(g, W, H, st) {
    const ac = st.ac, world = st.world;
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, W, H);
    if (!st.ndOn) {
      txt(g, 'NAVIGATION AUS', W / 2, H / 2, Math.max(10, W * 0.05), '#59636e', 'center');
      return;
    }
    const s = Math.min(W / 280, H / 250);
    const cx = W / 2, cy = H * 0.74;
    const R = Math.min(W * 0.47, H * 0.64);
    const range = st.ndRange;
    const sc = R / range;
    const fx = Math.sin(ac.hdg), fz = -Math.cos(ac.hdg), rx = Math.cos(ac.hdg), rz = Math.sin(ac.hdg);
    const toS = (x, z) => {
      const dx = x - ac.pos.x, dz = z - ac.pos.z;
      return [cx + (dx * rx + dz * rz) * sc, cy - (dx * fx + dz * fz) * sc];
    };
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    // Gelände
    const cs = Math.max(7, R / 9);
    // Warnfarben: rot = Gelände auf/über Flughöhe, gelb = knapp darunter (in Bodennähe unterdrückt)
    const raM = Math.max(0, ac.ra);
    const redM = raM < 20 ? -1e6 : Math.min(40, raM * 0.4);
    const ambM = raM < 20 ? -1e6 : Math.min(250, raM * 0.8);
    for (let sy = cy - R * 1.02; sy < H; sy += cs) {
      for (let sx = cx - R * 1.1; sx < cx + R * 1.1; sx += cs) {
        const lx = (sx + cs / 2 - cx) / sc, ly = (cy - sy - cs / 2) / sc;
        if (lx * lx + ly * ly > range * range * 1.25) continue;
        const h = world.heightAt(ac.pos.x + rx * lx + fx * ly, ac.pos.z + rz * lx + fz * ly);
        let c;
        if (h < 0.2) c = '#0a2740';
        else if (h > ac.pos.y - redM) c = '#9c1f1f';
        else if (h > ac.pos.y - ambM) c = '#806010';
        else c = h > 500 ? '#1d4a24' : h > 150 ? '#173d1e' : '#122f18';
        g.fillStyle = c;
        g.fillRect(sx, sy, cs + 0.6, cs + 0.6);
      }
    }
    // Entfernungsringe
    g.strokeStyle = 'rgba(220,230,240,0.55)';
    g.lineWidth = 1;
    for (const k of [0.5, 1]) {
      g.beginPath();
      g.arc(cx, cy, R * k, Math.PI * 1.02, Math.PI * 1.98);
      g.stroke();
    }
    txt(g, (range / 2000).toFixed(range < 8000 ? 1 : 0) + ' km', cx + R * 0.5 * 0.72, cy - R * 0.5 * 0.72 - 6 * s, 9 * s, '#aab6c2', 'left', MONO);
    // Kompassmarken
    const hdgDeg = ac.hdg * DEG;
    for (let d = 0; d < 360; d += 10) {
      const rel = U.wrapPi((d - hdgDeg) * RAD);
      if (Math.abs(rel) > 1.45) continue;
      const a = rel - Math.PI / 2;
      const r1 = R, r2 = R + (d % 30 === 0 ? 7 : 4) * s;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.stroke();
      if (d % 30 === 0) {
        const lab = d === 0 ? 'N' : d === 90 ? 'O' : d === 180 ? 'S' : d === 270 ? 'W' : String(d / 10);
        if (d % 90 === 0) txt(g, lab, cx + Math.cos(a) * (R + 15 * s), cy + Math.sin(a) * (R + 15 * s), 12 * s, COL.cyan, 'center', FONT, '800');
        else txt(g, lab, cx + Math.cos(a) * (R + 15 * s), cy + Math.sin(a) * (R + 15 * s), 10 * s, '#cfd8e0', 'center', MONO);
      }
    }
    // Route
    if (st.gates && st.gateIdx < st.gates.length) {
      g.strokeStyle = COL.mag;
      g.lineWidth = 1.6 * s;
      g.beginPath();
      g.moveTo(cx, cy);
      for (let i = st.gateIdx; i < st.gates.length; i++) {
        const p = toS(st.gates[i].x, st.gates[i].z);
        g.lineTo(p[0], p[1]);
      }
      const e = st.dest;
      const p = toS(e.thr.x, e.thr.z);
      g.lineTo(p[0], p[1]);
      g.stroke();
      g.fillStyle = COL.mag;
      for (let i = st.gateIdx; i < st.gates.length; i++) {
        const q = toS(st.gates[i].x, st.gates[i].z);
        g.beginPath();
        g.arc(q[0], q[1], (i === st.gateIdx ? 3.4 : 2) * s, 0, 7);
        g.fill();
      }
    }
    // Landebahnen
    for (const ap of world.airports) {
      const a = toS(ap.x - ap.fx * ap.len / 2, ap.z - ap.fz * ap.len / 2);
      const b = toS(ap.x + ap.fx * ap.len / 2, ap.z + ap.fz * ap.len / 2);
      g.strokeStyle = '#fff';
      g.lineWidth = Math.max(2.5, 45 * sc);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
      const c = toS(ap.x, ap.z);
      txt(g, ap.code, c[0] + 8 * s, c[1] - 8 * s, 10 * s, COL.cyan, 'left');
      // verlängerte Anfluglinie
      g.strokeStyle = 'rgba(66,212,255,0.5)';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      for (const e of ap.ends) {
        const t0 = toS(e.thr.x, e.thr.z), t1 = toS(e.thr.x - e.fx * 9000, e.thr.z - e.fz * 9000);
        g.beginPath();
        g.moveTo(t0[0], t0[1]);
        g.lineTo(t1[0], t1[1]);
        g.stroke();
      }
      g.setLineDash([]);
    }
    g.restore();
    // Flugzeug
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, cy - 9 * s);
    g.lineTo(cx - 6 * s, cy + 6 * s);
    g.lineTo(cx, cy + 2.5 * s);
    g.lineTo(cx + 6 * s, cy + 6 * s);
    g.closePath();
    g.fill();
    g.stroke();
    // Texte
    const pad = 6 * s;
    g.fillStyle = 'rgba(5,8,12,0.72)';
    g.fillRect(0, 0, W, 19 * s);
    txt(g, 'GS ' + Math.round(ac.gs * KT) + ' kt', pad, 10 * s, 11 * s, COL.g, 'left', MONO, '700');
    if (st.destDist != null) txt(g, st.dest.ap.code + ' ' + (st.destDist / 1000).toFixed(1) + ' km', W - pad, 10 * s, 11 * s, COL.mag, 'right', MONO, '700');
    txt(g, U.pad(U.wrap360(Math.round(hdgDeg)) % 360, 3) + '°', cx, 10 * s, 11 * s, '#fff', 'center', MONO, '700');
    // Wind
    const wv = st.wind;
    const wspd = Math.hypot(wv.x, wv.z);
    const wfrom = U.wrap360(Math.atan2(-wv.x, wv.z) * DEG);
    g.fillStyle = 'rgba(5,8,12,0.72)';
    g.fillRect(0, H - 19 * s, 104 * s, 19 * s);
    txt(g, 'WIND ' + U.pad(Math.round(wfrom / 5) * 5 % 360, 3) + '°/' + Math.round(wspd * KT) + 'kt', pad, H - 9.5 * s, 9.5 * s, '#cfd8e0', 'left', MONO);
    if (wspd > 0.8) {
      // Pfeil in Windrichtung (relativ zum Kurs)
      const a = Math.atan2(wv.x * rx + wv.z * rz, wv.x * fx + wv.z * fz);
      g.save();
      g.translate(W - 16 * s, H - 16 * s);
      g.rotate(a);
      g.strokeStyle = COL.cyan;
      g.lineWidth = 1.6 * s;
      g.beginPath();
      g.moveTo(0, 8 * s);
      g.lineTo(0, -8 * s);
      g.lineTo(-4 * s, -3 * s);
      g.moveTo(0, -8 * s);
      g.lineTo(4 * s, -3 * s);
      g.stroke();
      g.restore();
    }
  }

  /* ================= Triebwerke / Systeme ================= */
  function drawGauge(g, x, y, r, e, label, blink) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const val = clamp(e.n1, 0, 1.05);
    g.lineWidth = 5;
    g.strokeStyle = '#27313c';
    g.beginPath();
    g.arc(x, y, r, a0, a1);
    g.stroke();
    g.strokeStyle = COL.r;
    g.beginPath();
    g.arc(x, y, r, a0 + (a1 - a0) * 0.97, a1);
    g.stroke();
    const col = e.fire ? COL.r : !e.running ? '#7b8794' : COL.g;
    g.strokeStyle = col;
    g.beginPath();
    g.arc(x, y, r, a0, a0 + (a1 - a0) * Math.min(val, 1));
    g.stroke();
    const an = a0 + (a1 - a0) * Math.min(val, 1);
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + Math.cos(an) * (r - 12), y + Math.sin(an) * (r - 12));
    g.lineTo(x + Math.cos(an) * (r + 3), y + Math.sin(an) * (r + 3));
    g.stroke();
    txt(g, (val * 100).toFixed(0), x, y - 1, 16, col === '#7b8794' ? '#aab6c2' : '#fff', 'center', MONO, '700');
    txt(g, 'N1 %', x, y + 13, 8, '#8fa0b0', 'center');
    txt(g, label, x, y + r + 3, 9.5, '#cfd8e0', 'center');
    let state = null, sc = COL.a;
    if (e.fire) {
      state = 'BRAND';
      sc = COL.r;
    } else if (e.restartT > 0) {
      state = 'START';
      sc = COL.g;
    } else if (!e.running) state = 'AUS';
    if (state && (blink || !e.fire)) {
      g.fillStyle = sc;
      rr(g, x - 22, y - r - 11, 44, 13, 3);
      g.fill();
      txt(g, state, x, y - r - 4, 9, '#000', 'center', FONT, '800');
    }
    txt(g, 'EGT ' + Math.round(e.egt) + '°', x, y + r + 16, 9, e.egt > 900 ? COL.r : '#aab6c2', 'center', MONO);
  }

  function drawEICAS(g, W, H, st) {
    const ac = st.ac;
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, W, H);
    g.save();
    fit(g, W, H, 300, 250);
    drawGauge(g, 56, 58, 34, ac.eng[0], 'TRIEBWERK 1', st.blink);
    drawGauge(g, 150, 58, 34, ac.eng[1], 'TRIEBWERK 2', st.blink);

    // Treibstoff
    const fq = ac.fuel;
    txt(g, 'TREIBSTOFF', 252, 16, 8.5, '#8fa0b0', 'center');
    txt(g, Math.round(fq / 10) * 10 + ' kg', 252, 30, 12, fq < 350 ? COL.r : ac.sys.fuelLeak > 0 ? COL.a : '#fff', 'center', MONO, '700');
    g.fillStyle = '#27313c';
    g.fillRect(214, 39, 76, 5);
    g.fillStyle = fq < 350 ? COL.r : ac.sys.fuelLeak > 0 ? COL.a : COL.g;
    g.fillRect(214, 39, 76 * clamp(fq / FS.Aircraft.P.FUEL0, 0, 1), 5);

    // Klappen
    txt(g, 'KLAPPEN', 252, 58, 8.5, '#8fa0b0', 'center');
    for (let i = 0; i <= 3; i++) {
      g.fillStyle = ac.flaps >= i - 0.05 && i > 0 ? (ac.sys.flapsJam || !ac.sys.hyd ? COL.a : COL.g) : '#27313c';
      g.fillRect(214 + i * 19.5, 66, 17, 7);
    }
    g.strokeStyle = '#fff';
    g.lineWidth = 1.2;
    g.strokeRect(214 + ac.flapsTarget * 19.5 - 1, 65, 19, 9);
    txt(g, ['EIN', '1', '2', 'VOLL'][Math.round(ac.flaps)] || '', 252, 84, 10, '#fff', 'center', MONO, '700');

    // Fahrwerk
    txt(g, 'FAHRWERK', 252, 101, 8.5, '#8fa0b0', 'center');
    const gbox = (x, y, v) => {
      const down = v > 0.99, up = v < 0.01;
      g.fillStyle = down ? COL.g : up ? '#27313c' : COL.r;
      rr(g, x - 9, y - 7, 18, 14, 3);
      g.fill();
      if (down) txt(g, '▼', x, y + 0.5, 9, '#000', 'center');
    };
    gbox(252, 114, ac.gear[0]);
    gbox(230, 128, ac.gear[1]);
    gbox(274, 128, ac.gear[2]);

    // Meldungen
    g.fillStyle = '#0c1118';
    rr(g, 6, 142, 288, 104, 5);
    g.fill();
    g.strokeStyle = '#27313c';
    g.lineWidth = 1;
    g.stroke();
    const msgs = st.msgs;
    if (!msgs.length) txt(g, 'ALLE SYSTEME NORMAL', 150, 194, 11, '#3f8f58', 'center');
    for (let i = 0; i < Math.min(msgs.length, 6); i++) {
      const m = msgs[i];
      const c = m.c === 'r' ? COL.r : m.c === 'a' ? COL.a : COL.g;
      if (m.c === 'r' && !st.blink) g.globalAlpha = 0.55;
      txt(g, (m.c === 'r' ? '■ ' : m.c === 'a' ? '▲ ' : '● ') + m.t, 14, 155 + i * 15.5, 11.5, c, 'left', FONT, '700');
      g.globalAlpha = 1;
    }
    g.restore();
  }

  /* ================= Verwaltung ================= */
  const Panel = {
    cv: {},
    init(pfd, nd, eicas) {
      this.cv = { pfd, nd, eicas };
      this.ctx = { pfd: pfd.getContext('2d'), nd: nd.getContext('2d'), eicas: eicas.getContext('2d') };
      this.resize();
    },
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      for (const k in this.cv) {
        const c = this.cv[k];
        const w = Math.max(1, Math.round(c.clientWidth)), h = Math.max(1, Math.round(c.clientHeight));
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
      }
    },
    _draw(k, fn, st) {
      const c = this.cv[k], g = this.ctx[k];
      if (!c.width || c.clientWidth === 0) return;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      fn(g, c.width / this.dpr, c.height / this.dpr, st);
    },
    draw(st, frame) {
      this._draw('pfd', drawPFD, st);
      if (frame % 3 === 0) this._draw('eicas', drawEICAS, st);
      if (frame % 6 === 1) this._draw('nd', drawND, st);
    },
    drawAll(st) {
      this._draw('pfd', drawPFD, st);
      this._draw('eicas', drawEICAS, st);
      this._draw('nd', drawND, st);
    },
  };

  FS.Panel = Panel;
})();
