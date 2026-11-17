/* Flugsimulator – Flugphysik: zweistrahliger Regionaljet mit Fly-by-Wire */
(function () {
  'use strict';
  const FS = window.FS;
  const U = FS.U;
  const { clamp, lerp, smoothstep, RAD } = U;
  const G = 9.81;

  const P = {
    mass: 20000, S: 80,
    Ipitch: 3.5e5, Iyaw: 5.5e5, Iroll: 2.0e5,
    CLA: 5.2, CD0: 0.024, K: 0.045, CD_GEAR: 0.022, CYB: -0.9,
    TMAX: 40000, ENG_ARM: 4.2,
    MS: 4.0, A_REF: 3 * RAD, MQ: 2.5, ME: 3.0, MSTALL: 25,
    LA: 4.0, LP: 3.0, LB: 2.0,
    NB: 3.0, NR: 1.5, NDR: 0.95,
    KQ: 6, KP: 5, QMAX: 0.22, PMAX: 0.55,
    AN: 0.2,
    FUEL0: 2200,
  };
  // Klappenstufen: Auftriebsbeiwert bei alpha=0, Abrisswinkel, Zusatzwiderstand
  const FLAPS = [
    { cl0: 0.20, as: 15 * RAD, cd: 0.0 },
    { cl0: 0.38, as: 15 * RAD, cd: 0.010 },
    { cl0: 0.55, as: 14.5 * RAD, cd: 0.025 },
    { cl0: 0.70, as: 14.5 * RAD, cd: 0.055 },
  ];
  // Fahrwerk (Körperkoordinaten: x rechts, y oben, z hinten)
  const GEAR = [
    { x: 0, y: -2.3, z: -7.0, k: 1.5e5, c: 4.0e4 },
    { x: -2.8, y: -2.4, z: 1.0, k: 4.5e5, c: 9.0e4 },
    { x: 2.8, y: -2.4, z: 1.0, k: 4.5e5, c: 9.0e4 },
  ];
  const BELLY = [
    { x: 0, y: -1.25, z: -6.5 },
    { x: -2.4, y: -1.3, z: 1.0 },
    { x: 2.4, y: -1.3, z: 1.0 },
  ];
  const BELLY_K = 9e5, BELLY_C = 1.5e5;
  const STRUCT = [
    { x: -13, y: 0.3, z: 2.2, n: 'wing' },
    { x: 13, y: 0.3, z: 2.2, n: 'wing' },
    { x: 0, y: -0.4, z: -10.5, n: 'nose' },
  ];
  const GEAR_H = 2.2; // Höhe des Schwerpunkts über Grund im Stand

  const T1 = new THREE.Vector3(), T2 = new THREE.Vector3(), T3 = new THREE.Vector3(), T4 = new THREE.Vector3();
  const R = new THREE.Vector3(), TB = new THREE.Vector3(), AX = new THREE.Vector3();
  const QI = new THREE.Quaternion(), DQ = new THREE.Quaternion();
  const EUL = new THREE.Euler();

  function mkEngine() {
    return {
      n1: 0.22, egt: 420, running: true, fire: false, fireT: 0, shut: false,
      restartable: true, restartT: 0, bottles: 2, extT: 0, fireNeeds: 1, thrustFrac: 0, thrust: 0, ff: 0,
    };
  }

  class Aircraft {
    constructor(world) {
      this.world = world;
      this.pos = new THREE.Vector3();
      this.vel = new THREE.Vector3();
      this.quat = new THREE.Quaternion();
      this.omega = new THREE.Vector3(); // Körperachsen: x=Nicken(hoch+), y=Gieren(links+), z=Rollen(links+)
      this.gust = new THREE.Vector3();
      this.turbRot = new THREE.Vector3();
      this.cfg = { alphaProt: 0.035, bankLim: 35 * RAD, pitchLim: true, autoLevel: 0.35, rudderAssist: 1, sinkLimit: 6.5, fireLimit: 90 };
      this.reset();
    }

    reset() {
      this.throttle = 0;
      this.flapsTarget = 0;
      this.flaps = 0;
      this.gearTarget = 1;
      this.gear = [1, 1, 1];
      this.spoilers = 0;
      this.steerAngle = 0;
      this.brakeEff = 0;
      this.eng = [mkEngine(), mkEngine()];
      this.fuel = P.FUEL0;
      this.sys = {
        hyd: true, elec: true, emerPower: false, emerPowerT: 0, pitot: true, flapsJam: false,
        gearJam: false, noseGearDead: false, emerGear: false, fuelLeak: 0,
      };
      this.vel.set(0, 0, 0);
      this.omega.set(0, 0, 0);
      this.gust.set(0, 0, 0);
      this.turbRot.set(0, 0, 0);
      this.wow = [false, false, false];
      this.onGround = false;
      this.wowMain = false;
      this.airborne = false;
      this.airT = 0;
      this.groundT = 0;
      this.hasFlown = false;
      this.landings = [];
      this.crash = null;
      this.ditch = null;
      this.events = [];
      this.stallDir = 1;
      this.stalled = false;
      this.stallWarn = false;
      this.surface = 'runway';
      this.de = 0; this.da = 0; this.dr = 0;
      this.alpha = 0; this.beta = 0; this.aStall = FLAPS[0].as;
      this.ias = 0; this.tas = 0; this.gs = 0; this.vs = 0; this.ra = 0;
      this.pitch = 0; this.bank = 0; this.hdg = 0;
      this.shakeGround = 0;
      this.time = 0;
    }

    /** Aufstellung am Boden */
    placeOnGround(x, z, hdg) {
      const h = this.world.heightAt(x, z);
      this.pos.set(x, h + GEAR_H + 0.02, z);
      EUL.set(-0.5 * RAD, -hdg, 0, 'YXZ');
      this.quat.setFromEuler(EUL);
      this.vel.set(0, 0, 0);
      this.omega.set(0, 0, 0);
      this._derive(1.225);
    }

    /** Aufstellung in der Luft (ausgetrimmt) */
    placeInAir(x, y, z, hdg, speed, flaps) {
      this.pos.set(x, y, z);
      this.flaps = this.flapsTarget = flaps || 0;
      const rho = 1.225 * Math.exp(-y / 8500);
      const fl = this._flap();
      const cl = (P.mass * G) / (0.5 * rho * speed * speed * P.S);
      const alpha = (cl - fl.cl0) / P.CLA;
      EUL.set(alpha, -hdg, 0, 'YXZ');
      this.quat.setFromEuler(EUL);
      this.vel.set(Math.sin(hdg) * speed, 0, -Math.cos(hdg) * speed);
      this.omega.set(0, 0, 0);
      this.gearTarget = 0;
      this.gear = [0, 0, 0];
      this.airborne = true;
      this.hasFlown = true;
      this.airT = 5;
      for (const e of this.eng) e.n1 = 0.22 + 0.78 * this.throttle;
      this._derive(rho);
    }

    _flap() {
      const f = clamp(this.flaps, 0, 3);
      const i = Math.min(2, Math.floor(f)), t = f - i;
      const a = FLAPS[i], b = FLAPS[i + 1];
      return { cl0: lerp(a.cl0, b.cl0, t), as: lerp(a.as, b.as, t), cd: lerp(a.cd, b.cd, t) };
    }

    /** Überziehgeschwindigkeit (m/s, angezeigt) für aktuelle Klappenstellung */
    stallSpeed() {
      const fl = this._flap();
      const clMax = fl.cl0 + P.CLA * fl.as;
      return Math.sqrt((2 * P.mass * G) / (1.225 * P.S * clMax));
    }

    /* ---------- Bedienaktionen ---------- */
    setGear(down) {
      if (!down && this.onGround) return false;
      this.gearTarget = down ? 1 : 0;
      return true;
    }
    setFlaps(n) {
      this.flapsTarget = clamp(n, 0, 3);
    }
    fireHandle(i) {
      const e = this.eng[i];
      if (!e.shut) {
        e.shut = true;
        e.running = false;
        if (e.fire) e.restartable = false;
        this.events.push({ type: 'engShut', i });
      }
      if (e.bottles > 0 && e.extT <= 0) {
        e.bottles--;
        e.extT = 2.2;
        this.events.push({ type: 'extinguisher', i });
        return true;
      }
      return false;
    }
    restart() {
      let any = false;
      for (let i = 0; i < 2; i++) {
        const e = this.eng[i];
        if (!e.running && !e.fire && e.restartT <= 0) {
          e.restartT = 6;
          e.tried = true;
          any = true;
          this.events.push({ type: 'restartBegin', i });
        }
      }
      return any;
    }
    emergencyGear() {
      if (this.sys.emerGear) return false;
      this.sys.emerGear = true;
      this.gearTarget = 1;
      this.events.push({ type: 'emerGear' });
      return true;
    }
    emergencyPower() {
      if (this.sys.elec || this.sys.emerPower || this.sys.emerPowerT > 0) return false;
      this.sys.emerPowerT = 4;
      this.events.push({ type: 'emerPowerBegin' });
      return true;
    }

    /* ---------- Systeme ---------- */
    _systems(dt) {
      const s = this.sys;
      // Triebwerke
      for (let i = 0; i < 2; i++) {
        const e = this.eng[i];
        if (e.restartT > 0) {
          e.restartT -= dt;
          if (e.restartT <= 0) {
            if (e.restartable && this.fuel > 0 && !e.fire) {
              e.running = true;
              e.shut = false;
              this.events.push({ type: 'restartOK', i });
            } else this.events.push({ type: 'restartFail', i });
          }
        }
        let target = e.running ? 0.22 + 0.78 * this.throttle : clamp(this.ias / 350, 0, 0.13);
        if (e.fire && e.running) target *= 0.82;
        const tau = !e.running ? 2.0 : target > e.n1 ? 1.7 : 1.3;
        e.n1 += (target - e.n1) * (1 - Math.exp(-dt / tau));
        e.thrustFrac = e.running ? Math.pow(Math.max(0, (e.n1 - 0.18) / 0.82), 1.6) : 0;
        const egtT = e.fire ? 1010 : e.running ? 360 + 440 * e.n1 : 60 + 200 * e.n1;
        e.egt += (egtT - e.egt) * (1 - Math.exp(-dt / 2.5));
        if (e.fire) {
          e.fireT += dt;
          if (e.fireT > this.cfg.fireLimit && !this.crash) this.crash = { cause: 'fire' };
        }
        if (e.extT > 0) {
          e.extT -= dt;
          if (e.extT <= 0 && e.fire) {
            e.fireNeeds--;
            if (e.fireNeeds <= 0) {
              e.fire = false;
              this.events.push({ type: 'fireOut', i });
            } else this.events.push({ type: 'fireStill', i });
          }
        }
        e.ff = e.running ? 0.06 + 0.5 * e.thrustFrac : 0;
        this.fuel -= e.ff * dt;
      }
      this.fuel -= s.fuelLeak * dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        let was = false;
        for (const e of this.eng) {
          if (e.running) was = true;
          e.running = false;
          e.restartable = false;
        }
        if (was) this.events.push({ type: 'fuelOut' });
      }
      // Notstrom
      if (s.emerPowerT > 0) {
        s.emerPowerT -= dt;
        if (s.emerPowerT <= 0) {
          s.emerPower = true;
          this.events.push({ type: 'emerPowerOn' });
        }
      }
      // Fahrwerk
      let moving = false;
      for (let j = 0; j < 3; j++) {
        const before = this.gear[j];
        if (s.emerGear) {
          if (!(j === 0 && s.noseGearDead)) this.gear[j] = Math.min(1, this.gear[j] + dt / (8 + j));
        } else if (s.hyd && !s.gearJam) {
          const rate = dt / (5 + j * 0.5);
          if (this.gearTarget > this.gear[j]) this.gear[j] = Math.min(1, this.gear[j] + rate);
          else if (this.gearTarget < this.gear[j] && !this.onGround) this.gear[j] = Math.max(0, this.gear[j] - rate);
        }
        if (this.gear[j] !== before) {
          moving = true;
          if (this.gear[j] === 1) this.events.push({ type: 'gearLock', j });
          if (this.gear[j] === 0) this.events.push({ type: 'gearUp', j });
        }
      }
      this.gearMoving = moving;
      // Klappen
      const fb = this.flaps;
      if (s.hyd && !s.flapsJam) {
        const d = this.flapsTarget - this.flaps;
        this.flaps += clamp(d, -dt / 2.6, dt / 2.6);
      }
      this.flapsMoving = this.flaps !== fb;
      // Störklappen am Boden
      const spT = this.wowMain && this.throttle < 0.2 && this.gs > 12 ? (s.hyd ? 1 : 0.4) : 0;
      this.spoilers += clamp(spT - this.spoilers, -dt * 2, dt * 2);
    }

    /**
     * Ein Physikschritt.
     * ctl: {pitch(+ziehen), roll(+rechts), yaw(+rechts), throttle 0..1, brake 0..1}
     * env: {wind: Vector3, turb, wet}
     */
    step(dt, ctl, env) {
      if (this.crash || this.ditch) return;
      const w = this.world, cfg = this.cfg, s = this.sys;
      this.time += dt;
      this.throttle = clamp(ctl.throttle, 0, 1);
      this._systems(dt);
      if (this.crash) return;

      // --- Turbulenz
      const ti = env.turb || 0;
      if (ti > 0) {
        const k = Math.sqrt((2 * dt) / 1.8), k2 = Math.sqrt((2 * dt) / 0.6);
        this.gust.x += (-this.gust.x / 1.8) * dt + ti * 1.5 * k * U.randn();
        this.gust.y += (-this.gust.y / 1.8) * dt + ti * 1.0 * k * U.randn();
        this.gust.z += (-this.gust.z / 1.8) * dt + ti * 1.5 * k * U.randn();
        this.turbRot.x += (-this.turbRot.x / 0.6) * dt + ti * 0.05 * k2 * U.randn();
        this.turbRot.y += (-this.turbRot.y / 0.6) * dt + ti * 0.035 * k2 * U.randn();
        this.turbRot.z += (-this.turbRot.z / 0.6) * dt + ti * 0.13 * k2 * U.randn();
      }

      // --- Luftdaten
      const rho = 1.225 * Math.exp(-this.pos.y / 8500);
      const va = T2.copy(this.vel).sub(env.wind).sub(this.gust);
      // in Bodennähe gibt es kaum senkrechte Böen
      va.y += this.gust.y * (1 - clamp(this.ra / 50, 0.15, 1));
      const V = va.length();
      QI.copy(this.quat).invert();
      const vb = T3.copy(va).applyQuaternion(QI);
      const lowV = smoothstep(4, 14, V);
      const alpha = Math.atan2(-vb.y, -vb.z) * lowV;
      const beta = Math.asin(clamp(vb.x / Math.max(V, 1), -1, 1)) * lowV;
      const qbar = 0.5 * rho * V * V;
      const qN = qbar / 6125;
      const dampN = (rho * V) / 122.5;
      const airborne = !this.onGround;

      // --- Auftrieb / Widerstand
      const fl = this._flap();
      const aS = fl.as, aN = P.AN;
      let cl;
      if (alpha > aS) {
        const clMax = fl.cl0 + P.CLA * aS, x = alpha - aS;
        cl = x < 0.25 ? clMax * (1 - 1.8 * x) : (0.55 * clMax * Math.sin(2 * alpha)) / Math.sin(2 * (aS + 0.25));
      } else if (alpha < -aN) {
        const clMin = fl.cl0 - P.CLA * aN, x = -alpha - aN;
        cl = x < 0.25 ? clMin * (1 - 1.8 * x) : (0.55 * clMin * Math.sin(2 * -alpha)) / Math.sin(2 * (aN + 0.25));
      } else cl = fl.cl0 + P.CLA * alpha;
      cl *= 1 - 0.55 * this.spoilers;
      const gearExt = (this.gear[0] + this.gear[1] + this.gear[2]) / 3;
      const deadEng = (this.eng[0].running ? 0 : 1) + (this.eng[1].running ? 0 : 1);
      const sa = Math.sin(alpha), ca = Math.cos(alpha);
      let cd = P.CD0 + fl.cd + P.CD_GEAR * gearExt + P.K * Math.min(cl * cl, 4) + 0.5 * beta * beta + 0.006 * deadEng + 0.07 * this.spoilers;
      cd += 1.3 * sa * sa * smoothstep(aS, aS + 0.2, Math.abs(alpha));
      const L = qbar * P.S * cl, D = qbar * P.S * cd;

      // Schub
      const lapse = Math.pow(rho / 1.225, 0.75) * Math.max(0.25, 1 - V / 300);
      let thrust = 0;
      for (const e of this.eng) {
        e.thrust = P.TMAX * e.thrustFrac * lapse;
        thrust += e.thrust;
      }
      const yawThrust = ((this.eng[0].thrust - this.eng[1].thrust) * P.ENG_ARM) / P.Iyaw;

      // Kräfte im Körpersystem
      let fbx = qbar * P.S * P.CYB * beta;
      let fby = L * ca;
      let fbz = -L * sa - thrust;
      if (V > 0.1) {
        fbx -= (D * vb.x) / V;
        fby -= (D * vb.y) / V;
        fbz -= (D * vb.z) / V;
      }
      const Fw = T1.set(fbx, fby, fbz).applyQuaternion(this.quat);

      // --- Momente (als Winkelbeschleunigungen) + Fly-by-Wire
      const p = -this.omega.z, q = this.omega.x, r = -this.omega.y;
      const auth = s.hyd ? 1 : 0.5;
      const lawOK = s.elec;
      const gain = lawOK ? 1 : 0.55;
      const stalled = airborne && (alpha > aS || alpha < -aN);
      if (stalled && !this.stalled) this.stallDir = Math.random() < 0.5 ? -1 : 1;
      this.stalled = stalled;
      this.stallWarn = airborne && alpha > aS - 0.06 && V > 20;

      // Nicken
      let mNat = -P.MS * (alpha - P.A_REF) * qN - P.MQ * q * dampN;
      if (alpha > aS) mNat -= P.MSTALL * (alpha - aS) * qN;
      if (alpha < -aN) mNat += P.MSTALL * (-alpha - aN) * qN;
      const qMax = Math.min(P.QMAX, (1.6 * G) / Math.max(V, 30));
      let qCmd = ctl.pitch * qMax;
      if (airborne && Math.abs(this.bank) < 1.3) qCmd += r * Math.tan(clamp(this.bank, -1.0, 1.0));
      if (lawOK && airborne) {
        if (cfg.alphaProt != null) {
          const aP = aS - cfg.alphaProt;
          if (alpha > aP) qCmd = Math.min(qCmd, -3.0 * (alpha - aP));
          else if (alpha > aP - 0.05) qCmd = Math.min(qCmd, (qMax * (aP - alpha)) / 0.05);
        }
        if (cfg.pitchLim) {
          if (this.pitch > 22 * RAD) qCmd = Math.min(qCmd, -(this.pitch - 22 * RAD) * 1.5);
          if (this.pitch < -14 * RAD) qCmd = Math.max(qCmd, (-14 * RAD - this.pitch) * 1.5);
        }
      }
      const eAuth = P.ME * auth * qN;
      const de = clamp((P.KQ * gain * (qCmd - q) - mNat) / (eAuth + 1e-4), -1, 1);
      const qdot = mNat + eAuth * de + this.turbRot.x;

      // Rollen
      const ailEff = 1 - 0.7 * smoothstep(aS - 0.02, aS + 0.08, alpha);
      let lNat = -P.LP * p * dampN - P.LB * beta * qN;
      if (stalled) lNat += this.stallDir * 1.3 * Math.sqrt(qN) * clamp((Math.abs(alpha) - aS) / 0.08 + 0.3, 0, 1);
      let pCmd = ctl.roll * P.PMAX;
      if (lawOK && airborne) {
        if (cfg.autoLevel && Math.abs(ctl.roll) < 0.04) pCmd = clamp(-cfg.autoLevel * this.bank, -0.25, 0.25);
        if (cfg.bankLim != null) {
          if (this.bank > cfg.bankLim) pCmd = Math.min(pCmd, -(this.bank - cfg.bankLim) * 2.5);
          if (this.bank < -cfg.bankLim) pCmd = Math.max(pCmd, (-cfg.bankLim - this.bank) * 2.5);
        }
      }
      const aAuth = P.LA * auth * ailEff * qN;
      const da = clamp((P.KP * gain * (pCmd - p) - lNat) / (aAuth + 1e-4), -1, 1);
      const pdot = lNat + aAuth * da + this.turbRot.z;

      // Gieren
      let dr = ctl.yaw;
      if (airborne && lawOK) dr += cfg.rudderAssist * clamp(3.5 * beta, -0.75, 0.75);
      dr = clamp(dr, -1, 1);
      const rdot = P.NB * beta * qN - P.NR * r * dampN + P.NDR * auth * qN * dr + yawThrust + this.turbRot.y;
      this.de = de; this.da = da; this.dr = dr;

      let odx = qdot, ody = -rdot, odz = -pdot;

      // --- Bodenkontakt
      const hCG = w.heightAt(this.pos.x, this.pos.z);
      const overWater = hCG < 0.2;
      const groundY = overWater ? 0 : hCG;
      let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
      let any = false, anyMain = false, maxSink = 0, newContact = false;
      const near = this.pos.y - groundY < 12;
      if (near) {
        const gsNow = Math.hypot(this.vel.x, this.vel.z);
        // Wasserberührung
        if (overWater && this.pos.y < 1.6 + 1.0 * gearExt) {
          const ok = gearExt < 0.1 && -this.vel.y < 3.6 && Math.abs(this.bank) < 10 * RAD && this.pitch > -1 * RAD && this.pitch < 14 * RAD && gsNow < 85;
          if (ok) this.ditch = { sink: -this.vel.y, speed: gsNow };
          else this.crash = { cause: 'water' };
          return;
        }
        // Strukturpunkte
        for (const sp of STRUCT) {
          R.set(sp.x, sp.y, sp.z).applyQuaternion(this.quat);
          const px = this.pos.x + R.x, pz = this.pos.z + R.z;
          const h = Math.max(0, w.heightAt(px, pz));
          if (this.pos.y + R.y < h && gsNow > 6) {
            // am Flugplatz: Flügel/Nase aufgesetzt – sonst Geländekollision
            this.crash = { cause: w.surfaceAt(px, pz).ap ? sp.n : 'terrain' };
            return;
          }
        }
        if (this.pos.y < groundY + 0.6) {
          this.crash = { cause: 'terrain' };
          return;
        }
        const surf = w.surfaceAt(this.pos.x, this.pos.z);
        this.surface = surf.type;
        const paved = surf.type === 'runway' || surf.type === 'paved';
        const muRoll = paved ? 0.015 : 0.075;
        const muLat = (paved ? 0.75 : 0.6) * (env.wet ? 0.75 : 1);
        const muBrake = (paved ? 0.42 : 0.3) * (env.wet ? 0.72 : 1);
        const omW = T4.copy(this.omega).applyQuaternion(this.quat);
        const fwd = TB.set(0, 0, -1).applyQuaternion(this.quat);
        const fh = Math.hypot(fwd.x, fwd.z) || 1;
        const fxh = fwd.x / fh, fzh = fwd.z / fh;
        // Bugradlenkung
        const steerIn = clamp(ctl.yaw + 0.7 * ctl.roll, -1, 1);
        this.steerAngle = (steerIn * 0.55 * (s.hyd ? 1 : 0.35)) / (1 + (gsNow / 9) * (gsNow / 9));
        this.brakeEff = clamp(ctl.brake, 0, 1) * (s.hyd ? 1 : 0.3);

        for (let j = 0; j < 3; j++) {
          const legDown = this.gear[j] > 0.99;
          const gp = legDown ? GEAR[j] : BELLY[j];
          R.set(gp.x, gp.y, gp.z).applyQuaternion(this.quat);
          const px = this.pos.x + R.x, py = this.pos.y + R.y, pz = this.pos.z + R.z;
          const h = w.heightAt(px, pz);
          const comp = h - py;
          if (comp <= 0 || h < 0.2) {
            this.wow[j] = false;
            continue;
          }
          const vx = this.vel.x + (omW.y * R.z - omW.z * R.y);
          const vy = this.vel.y + (omW.z * R.x - omW.x * R.z);
          const vz = this.vel.z + (omW.x * R.y - omW.y * R.x);
          const k = legDown ? gp.k : BELLY_K, c = legDown ? gp.c : BELLY_C;
          let Fn = k * comp - c * vy;
          if (legDown && comp > 0.45) Fn += 2.5e6 * (comp - 0.45);
          if (Fn < 0) Fn = 0;
          if (!this.wow[j]) {
            newContact = true;
            maxSink = Math.max(maxSink, -vy * (legDown ? 1 : 1.4));
          }
          this.wow[j] = true;
          any = true;
          if (j > 0) anyMain = true;
          let wx = fxh, wz = fzh;
          if (j === 0 && legDown) {
            const cs = Math.cos(this.steerAngle), sn = Math.sin(this.steerAngle);
            wx = fxh * cs - fzh * sn;
            wz = fzh * cs + fxh * sn;
          }
          const rx = -wz, rz = wx;
          const vLong = vx * wx + vz * wz, vLat = vx * rx + vz * rz;
          let Flong, Flat;
          if (legDown) {
            const mu = muRoll + (j > 0 ? this.brakeEff * muBrake : 0);
            Flong = -Fn * mu * Math.tanh(vLong / 0.5);
            Flat = -Fn * muLat * (j === 0 ? 0.6 : 1) * Math.tanh(vLat / 1.2);
          } else {
            const vh = Math.hypot(vLong, vLat) + 1e-6;
            const f = Fn * (paved ? 0.45 : 0.6) * Math.tanh(vh / 0.6);
            Flong = (-f * vLong) / vh;
            Flat = (-f * vLat) / vh;
          }
          const fwx = wx * Flong + rx * Flat, fwz = wz * Flong + rz * Flat;
          Fx += fwx; Fy += Fn; Fz += fwz;
          Tx += R.y * fwz - R.z * Fn;
          Ty += R.z * fwx - R.x * fwz;
          Tz += R.x * Fn - R.y * fwx;
        }
        if (any) {
          // Aufsetzen auswerten
          if (newContact && this.airborne) {
            const rec = {
              sink: maxSink, ias: this.ias, gs: gsNow, pitch: this.pitch, bank: this.bank,
              x: this.pos.x, z: this.pos.z, surface: surf.type, ap: surf.ap || null,
              along: surf.along, lat: surf.lat, gearDown: this.gear[1] > 0.99 && this.gear[2] > 0.99, t: this.time,
              vx: this.vel.x, vz: this.vel.z,
            };
            this.landings.push(rec);
            this.events.push({ type: 'touchdown', rec });
            this.airborne = false;
          } else if (newContact) {
            this.events.push({ type: 'wheel', sink: maxSink });
          }
          if (newContact && maxSink > cfg.sinkLimit) {
            this.crash = { cause: 'hard', sink: maxSink };
            return;
          }
          if (gsNow > 12 && surf.type === 'forest') {
            this.crash = { cause: 'trees' };
            return;
          }
          if (gsNow > 18 && (surf.type === 'rock' || surf.slope > 0.14)) {
            this.crash = { cause: 'terrain' };
            return;
          }
          this.shakeGround = clamp(gsNow / 70, 0, 1) * (paved ? 0.35 : 1.4);
          const tb = TB.set(Tx, Ty, Tz).applyQuaternion(QI);
          odx += tb.x / P.Ipitch;
          ody += tb.y / P.Iyaw;
          odz += tb.z / P.Iroll;
        } else this.shakeGround = 0;
        if (this.pos.y - groundY < 60 && w.obstacleHit(this.pos)) {
          this.crash = { cause: 'building' };
          return;
        }
      } else {
        this.wow[0] = this.wow[1] = this.wow[2] = false;
        this.shakeGround = 0;
      }
      this.onGround = any;
      this.wowMain = anyMain;
      if (any) {
        this.groundT += dt;
        this.airT = 0;
      } else {
        this.airT += dt;
        this.groundT = 0;
        if (this.airT > 1.2 && this.pos.y - groundY > GEAR_H + 2.5) {
          this.airborne = true;
          this.hasFlown = true;
        }
      }

      // --- Integration
      const m = P.mass;
      this.vel.x += ((Fw.x + Fx) / m) * dt;
      this.vel.y += ((Fw.y + Fy) / m - G) * dt;
      this.vel.z += ((Fw.z + Fz) / m) * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.omega.x += odx * dt;
      this.omega.y += ody * dt;
      this.omega.z += odz * dt;
      const wl = this.omega.length();
      if (wl > 1e-8) {
        DQ.setFromAxisAngle(AX.copy(this.omega).multiplyScalar(1 / wl), wl * dt);
        this.quat.multiply(DQ).normalize();
      }
      this.alpha = alpha;
      this.beta = beta;
      this.aStall = aS;
      this.tas = V;
      this.gForce = (fby + Fy) / (m * G);
      this._derive(rho);
    }

    _derive(rho) {
      const f = T1.set(0, 0, -1).applyQuaternion(this.quat);
      this.pitch = Math.asin(clamp(f.y, -1, 1));
      let h = Math.atan2(f.x, -f.z);
      if (h < 0) h += Math.PI * 2;
      this.hdg = h;
      const rgt = T2.set(1, 0, 0).applyQuaternion(this.quat);
      const up = T3.set(0, 1, 0).applyQuaternion(this.quat);
      this.bank = Math.atan2(-rgt.y, up.y);
      this.gs = Math.hypot(this.vel.x, this.vel.z);
      this.vs = this.vel.y;
      this.ias = (this.tas || 0) * Math.sqrt(rho / 1.225);
      const hg = Math.max(0, this.world.heightAt(this.pos.x, this.pos.z));
      this.ra = this.pos.y - hg - GEAR_H;
      this.track = Math.atan2(this.vel.x, -this.vel.z);
    }
  }

  Aircraft.P = P;
  Aircraft.GEAR_H = GEAR_H;
  FS.Aircraft = Aircraft;
})();
