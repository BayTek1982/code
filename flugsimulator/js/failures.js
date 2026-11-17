/* Flugsimulator – Störungen, Checklisten, Warnsysteme */
(function () {
  'use strict';
  const FS = window.FS;
  const U = FS.U;
  const { RAD, KT, FT } = U;

  function pickW(weights) {
    let sum = 0;
    for (const k in weights) sum += weights[k];
    let r = Math.random() * sum;
    for (const k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return Object.keys(weights)[0];
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function runningEngine(ac) {
    const c = [0, 1].filter((i) => ac.eng[i].running && !ac.eng[i].fire);
    return c.length ? c[Math.floor(Math.random() * c.length)] : -1;
  }

  const engOutSteps = (ac, i, restart) => {
    const e = ac.eng[i];
    const st = [{ t: 'Kurs halten – mit Seitenruder (A / D) gegensteuern' }];
    if (restart) st.push({ t: 'Neustart versuchen: Taste I', done: () => e.running || e.restartT > 0 || e.tried });
    else st.push({ t: 'Kein Neustart möglich – Triebwerk beschädigt' });
    st.push({ t: 'Schub erhöhen, mindestens 130 kt halten' });
    st.push({ t: 'Nächsten Flughafen anfliegen und landen' });
    return st;
  };

  /** Definitionen: geben ein Störungsobjekt zurück oder null (nicht anwendbar) */
  const DEFS = {
    engfail(ac, diff) {
      const i = runningEngine(ac);
      if (i < 0) return null;
      const e = ac.eng[i];
      e.running = false;
      e.restartable = Math.random() < (diff === 'hard' ? 0.2 : 0.5);
      return {
        id: 'engfail', level: 'warn', eng: i, fx: 'bang', name: 'Triebwerksausfall (Triebwerk ' + (i + 1) + ')',
        title: 'TRIEBWERK ' + (i + 1) + ' AUSGEFALLEN',
        steps: engOutSteps(ac, i, true),
      };
    },
    engfire(ac, diff) {
      const i = runningEngine(ac);
      if (i < 0) return null;
      const e = ac.eng[i];
      e.fire = true;
      e.burnt = true;
      e.fireT = 0;
      e.fireNeeds = diff === 'hard' && Math.random() < 0.4 ? 2 : 1;
      return {
        id: 'engfire', level: 'warn', eng: i, fx: 'fire', name: 'Triebwerksbrand (Triebwerk ' + (i + 1) + ')',
        title: 'FEUER IN TRIEBWERK ' + (i + 1),
        steps: [
          { t: 'SOFORT löschen: Taste ' + (i + 1) + ' (Feuerlöscher ' + (i + 1) + ')', done: () => !e.fire },
          { t: 'Brennt es weiter: Taste ' + (i + 1) + ' erneut drücken', done: () => !e.fire },
          { t: 'Kurs halten – mit Seitenruder (A / D) gegensteuern' },
          { t: 'Sofort den nächsten Flughafen anfliegen' },
        ],
      };
    },
    bird(ac) {
      const i = runningEngine(ac);
      if (i < 0) return null;
      const e = ac.eng[i];
      e.running = false;
      e.restartable = false;
      return {
        id: 'bird', level: 'warn', eng: i, fx: 'bird', name: 'Vogelschlag (Triebwerk ' + (i + 1) + ' aus)',
        title: 'VOGELSCHLAG – TRIEBWERK ' + (i + 1) + ' AUS',
        steps: engOutSteps(ac, i, false),
      };
    },
    hyd(ac) {
      if (!ac.sys.hyd) return null;
      ac.sys.hyd = false;
      return {
        id: 'hyd', level: 'caut', fx: 'caution', name: 'Hydraulikausfall',
        title: 'HYDRAULIK AUSGEFALLEN',
        steps: [
          { t: 'Steuerung ist träge – sanft und früh reagieren' },
          { t: 'Fahrwerk nur per Notausfahren: Taste X', done: () => ac.sys.emerGear || ac.gear[1] > 0.99 },
          { t: 'Klappen blockiert – Anflug mit ca. 140 kt' },
          { t: 'Bremsen schwach – am Bahnanfang aufsetzen' },
        ],
      };
    },
    elec(ac) {
      if (!ac.sys.elec) return null;
      ac.sys.elec = false;
      return {
        id: 'elec', level: 'warn', fx: 'elec', name: 'Stromausfall',
        title: 'STROMAUSFALL – BILDSCHIRME AUS',
        steps: [
          { t: 'Notstrom einschalten: Taste N', done: () => ac.sys.emerPower },
          { t: 'Flugschutz ist aus – vorsichtig steuern' },
          { t: 'Navigationsdisplay bleibt dunkel – nach Sicht fliegen' },
        ],
      };
    },
    pitot(ac) {
      if (!ac.sys.pitot) return null;
      ac.sys.pitot = false;
      ac.sys.pitotVal = ac.ias;
      return {
        id: 'pitot', level: 'caut', fx: 'caution', name: 'Fahrtmesser-Ausfall',
        title: 'FAHRTMESSER AUSGEFALLEN',
        steps: [
          { t: 'Geschwindigkeitsanzeige ist falsch!' },
          { t: 'Reiseflug: Nase 3° hoch, Schub ca. 45 %' },
          { t: 'GS (Tempo über Grund) im Navigationsdisplay nutzen' },
        ],
      };
    },
    fuel(ac, diff) {
      if (ac.sys.fuelLeak > 0) return null;
      // Leck so bemessen, dass der Treibstoff bei zügigem Weiterflug gerade noch reicht
      const d = FS.World.dest;
      const est = Math.hypot(ac.pos.x - d.thr.x, ac.pos.z - d.thr.z) / 90 + 80;
      const budget = Math.max(diff === 'hard' ? 230 : 320, est * (diff === 'hard' ? 1.3 : 1.7));
      ac.sys.fuelLeak = Math.max(1.5, ac.fuel / budget - 0.6);
      return {
        id: 'fuel', level: 'caut', fx: 'caution', name: 'Treibstoffleck',
        title: 'TREIBSTOFFLECK',
        steps: [
          { t: 'Treibstoff läuft aus – schnellstmöglich landen!' },
          { t: () => 'Restlaufzeit ca. ' + U.fmtTime(ac.fuel / (ac.sys.fuelLeak + ac.eng[0].ff + ac.eng[1].ff + 0.01)) + ' min' },
          { t: 'Ohne Treibstoff: im Gleitflug mit 140 kt landen' },
        ],
      };
    },
    gear(ac, diff) {
      if (ac.gear[1] > 0.5 && ac.gearTarget === 1) return null;
      if (ac.sys.gearJam) return null;
      ac.sys.gearJam = true;
      const nose = diff === 'hard' && Math.random() < 0.4;
      if (nose) ac.sys.noseGearDead = true;
      const steps = [{ t: 'Fahrwerk fährt nicht normal aus' }, { t: 'Notausfahren: Taste X', done: () => ac.sys.emerGear }];
      if (nose) {
        steps.push({ t: 'Bugfahrwerk klemmt! Sanft aufsetzen,' });
        steps.push({ t: 'Nase so lange wie möglich oben halten' });
      } else steps.push({ t: 'Drei grüne Lampen abwarten, dann landen' });
      return { id: 'gear', level: 'caut', fx: 'caution', name: nose ? 'Fahrwerksstörung (Bugfahrwerk klemmt)' : 'Fahrwerksstörung', title: 'FAHRWERK-STÖRUNG', steps };
    },
    flaps(ac) {
      if (ac.sys.flapsJam || !ac.sys.hyd) return null;
      ac.sys.flapsJam = true;
      return {
        id: 'flaps', level: 'caut', fx: 'caution', name: 'Landeklappen blockiert',
        title: 'LANDEKLAPPEN BLOCKIERT',
        steps: [
          { t: () => 'Klappen klemmen in Stellung ' + Math.round(ac.flaps) },
          { t: 'Schneller anfliegen (ca. 140 kt)' },
          { t: 'Lange Ausrollstrecke einplanen, kräftig bremsen' },
        ],
      };
    },
  };

  const Failures = {
    active: [],
    queue: [],
    airT: 0,
    diff: 'easy',

    reset() {
      this.active = [];
      this.queue = [];
      this.airT = 0;
    },

    plan(diff, scenario) {
      this.reset();
      this.diff = diff;
      const rnd = Math.random;
      const quick = scenario === 'approach';
      if (diff === 'medium') {
        const id = pickW({ engfail: 2, bird: 1.2, hyd: 2, elec: 2, pitot: 1.5, fuel: 1.2, gear: 1.6, flaps: 1 });
        const t = quick ? 10 + rnd() * 16 : 30 + rnd() * 55;
        this.queue.push({ t, id });
        if (rnd() < 0.3) {
          const minor = shuffle(['pitot', 'flaps', 'gear', 'elec']).find((m) => m !== id && !(id === 'hyd' && (m === 'flaps' || m === 'gear')));
          if (minor) this.queue.push({ t: t + (quick ? 28 + rnd() * 18 : 55 + rnd() * 40), id: minor });
        }
      } else if (diff === 'hard') {
        const first = pickW({ engfire: 4.5, engfail: 2.5, bird: 3 });
        let t = quick ? 7 + rnd() * 9 : 5 + rnd() * 22;
        this.queue.push({ t, id: first });
        const pool = shuffle(['hyd', 'elec', 'pitot', 'fuel', 'gear', 'flaps']);
        const n = 2 + (rnd() < 0.55 ? 1 : 0);
        let added = 0;
        const chosen = [];
        for (const id of pool) {
          if (added >= n) break;
          if (id === 'flaps' && chosen.includes('hyd')) continue;
          if (id === 'hyd' && chosen.includes('flaps')) continue;
          t += quick ? 22 + rnd() * 14 : 36 + rnd() * 30;
          this.queue.push({ t, id });
          chosen.push(id);
          added++;
        }
      }
    },

    /** Störung sofort auslösen; gibt Objekt oder null zurück */
    trigger(id, ac) {
      const def = DEFS[id];
      if (!def) return null;
      const f = def(ac, this.diff);
      if (!f) return null;
      f.t0 = ac.time;
      this.active.push(f);
      return f;
    },

    /** Zeitplan abarbeiten. Gibt neu ausgelöste Störungen zurück. */
    update(dt, ac) {
      const out = [];
      if (ac.hasFlown && !ac.onGround) this.airT += dt;
      for (const q of this.queue) {
        if (q.fired || this.airT < q.t) continue;
        // nicht mitten im Aufsetzen auslösen
        if (ac.ra < 25 && ac.vs < 0) continue;
        q.fired = true;
        let f = this.trigger(q.id, ac);
        if (!f && q.id === 'gear') f = this.trigger(ac.sys.hyd ? 'flaps' : 'pitot', ac);
        if (f) out.push(f);
      }
      return out;
    },

    /** Meldungen für die Triebwerks-/Systemanzeige */
    messages(ac, warn) {
      const m = [];
      const red = (t) => m.push({ t, c: 'r' }), amb = (t) => m.push({ t, c: 'a' }), grn = (t) => m.push({ t, c: 'g' });
      const e = ac.eng, s = ac.sys;
      if (warn.stall) red('STRÖMUNGSABRISS');
      if (warn.pullUp) red('BODEN – HOCHZIEHEN');
      for (let i = 0; i < 2; i++) if (e[i].fire) red('TRIEBWERK ' + (i + 1) + ' BRAND');
      if (!e[0].running && !e[1].running) red('BEIDE TRIEBWERKE AUS');
      else for (let i = 0; i < 2; i++) if (!e[i].running && !e[i].fire) amb('TRIEBWERK ' + (i + 1) + ' AUS');
      for (let i = 0; i < 2; i++) if (e[i].restartT > 0) grn('NEUSTART TRIEBWERK ' + (i + 1) + ' …');
      if (!s.elec) {
        if (s.emerPower) grn('NOTSTROM EIN');
        else red('KEIN STROM – TASTE N');
      }
      if (!s.hyd) amb('HYDRAULIK AUSFALL');
      if (!s.pitot) amb('FAHRTMESSER DEFEKT');
      if (s.flapsJam) amb('KLAPPEN BLOCKIERT');
      if (s.emerGear) {
        if (s.noseGearDead && ac.gear[1] > 0.99) red('BUGFAHRWERK KLEMMT');
        else grn('NOTFAHRWERK AKTIV');
      } else if (s.gearJam || !s.hyd) amb('FAHRWERK: NOTAUSFAHREN X');
      if (s.fuelLeak > 0) amb('TREIBSTOFFLECK');
      if (ac.fuel < 350) red('TREIBSTOFF NIEDRIG');
      if (warn.gear) red('FAHRWERK AUSFAHREN!');
      if (warn.overspeed) red('ZU SCHNELL');
      if (warn.cracked) amb('FRONTSCHEIBE BESCHÄDIGT');
      return m;
    },
  };

  /* ---------- Warnsysteme (Bodenannäherung, Überziehen, ...) ---------- */
  const Warn = {
    w: { stall: false, overspeed: false, pullUp: false, sinkRate: false, gear: false, bank: false, cracked: false },
    pullT: 0,
    reset() {
      this.w = { stall: false, overspeed: false, pullUp: false, sinkRate: false, gear: false, bank: false, cracked: false };
      this.pullT = 0;
    },
    update(dt, ac, world) {
      const w = this.w;
      const air = !ac.onGround && ac.hasFlown;
      w.stall = ac.stallWarn && air;
      w.overspeed = ac.ias * KT > 292;
      const gearDown = ac.gear[0] > 0.99 && ac.gear[1] > 0.99 && ac.gear[2] > 0.99;
      const mainsDown = ac.gear[1] > 0.99 && ac.gear[2] > 0.99;
      const sink = -ac.vs;
      const ra = ac.ra;
      // Landekonfiguration nahe einer Bahn -> Bodenwarnung unterdrücken
      let nearRunway = false;
      for (const ap of world.airports) {
        if (Math.hypot(ac.pos.x - ap.x, ac.pos.z - ap.z) < 5200 && ac.pos.y - ap.elev < 420) nearRunway = true;
      }
      const landing = nearRunway && (mainsDown || ac.sys.emerGear || ac.flaps > 1.5 || ac.ias * KT < 175);
      let pull = false, sinkW = false;
      if (air && ra > 3) {
        if (ra < 760) {
          if (sink > 10 + ra * 0.024) pull = true;
          else if (sink > 7.2 + ra * 0.017) sinkW = true;
        }
        if (!landing) {
          // Gelände voraus?
          for (let t = 3; t <= 15; t += 3) {
            const px = ac.pos.x + ac.vel.x * t, pz = ac.pos.z + ac.vel.z * t;
            const py = ac.pos.y + ac.vel.y * t;
            if (Math.max(0, world.heightAt(px, pz)) + 25 > py) {
              pull = true;
              break;
            }
          }
        } else if (ra < 60 && sink > 9) pull = true;
      }
      this.pullT = pull ? this.pullT + dt : 0;
      w.pullUp = this.pullT > 0.4;
      w.sinkRate = sinkW && !w.pullUp;
      w.gear = air && !mainsDown && ra < 160 && ac.ias * KT < 165 && (ac.vs < -0.5 || ac.throttle < 0.5) && ac.airT > 20;
      w.bank = air && Math.abs(ac.bank) > 50 * RAD && ra < 900;
      w.raFt = ra * FT;
      w.gearDown = gearDown;
      return w;
    },
  };

  FS.Failures = Failures;
  FS.Warn = Warn;
})();
