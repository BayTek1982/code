/* Flugsimulator – Spielablauf, Eingabe, Kamera, HUD */
(function () {
  'use strict';
  const FS = window.FS;
  const U = FS.U;
  const { clamp, RAD, DEG, KT, FT } = U;
  const { World, Aircraft, Failures, Warn, Panel, Model } = FS;
  const Snd = FS.Audio;
  const $ = (id) => document.getElementById(id);

  const DIFF = {
    easy: {
      name: 'LEICHT', weather: 'clear', gates: true, coach: true,
      cfg: { alphaProt: 0.035, bankLim: 35 * RAD, pitchLim: true, autoLevel: 0.35, rudderAssist: 1, sinkLimit: 6.5, fireLimit: 120 },
    },
    medium: {
      name: 'MITTEL', weather: 'cloudy', gates: true, coach: true,
      cfg: { alphaProt: 0.012, bankLim: 60 * RAD, pitchLim: false, autoLevel: 0, rudderAssist: 0.6, sinkLimit: 6.0, fireLimit: 100 },
    },
    hard: {
      name: 'SCHWER', weather: 'storm', gates: false, coach: false,
      cfg: { alphaProt: null, bankLim: null, pitchLim: false, autoLevel: 0, rudderAssist: 0.2, sinkLimit: 5.6, fireLimit: 70 },
    },
  };

  const KEYS_HTML = [
    ['↓ / ↑', 'Steuerhorn ziehen (steigen) / drücken (sinken)'],
    ['← / →', 'nach links / rechts rollen (Kurve)'],
    ['W / S', 'Schub erhöhen / verringern'],
    ['A / D', 'Seitenruder links / rechts (am Boden: lenken)'],
    ['G', 'Fahrwerk ein-/ausfahren'],
    ['F / R', 'Landeklappen aus- / einfahren'],
    ['Leertaste', 'Radbremsen (halten)'],
    ['V', 'Ansicht: Cockpit / Außen'],
    ['1 / 2', 'Feuerlöscher Triebwerk 1 / 2'],
    ['I', 'Triebwerk neu starten'],
    ['X', 'Fahrwerk-Notausfahren'],
    ['N', 'Notstrom einschalten'],
    ['Enter', 'Warnton quittieren'],
    ['P · M · H', 'Pause · Ton · Hilfe'],
  ].map((k) => '<kbd>' + k[0] + '</kbd><span>' + k[1] + '</span>').join('');

  /* ---------- Zustand ---------- */
  const app = $('app'), view = $('view');
  let renderer, scene, camera, ac;
  let state = 'menu'; // menu | fly | ending | result
  let paused = false, helpOpen = false;
  let selDiff = 'easy', selScen = 'full', invert = false;
  let extView = false;
  let frameNo = 0, last = 0;
  let m = null; // Mission
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const keys = {};
  const hold = { brake: false, rudL: false, rudR: false };
  const stick = { on: false, id: -1, x0: 0, y0: 0, x: 0, y: 0, r: 90 };
  const ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
  const env = { wind: new THREE.Vector3(), turb: 0, wet: false };
  let shakeImp = 0, flashRed = 0;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 2), slowT = 0;
  const VIEW_SHIFT = 0.1;
  let viewW = 1, viewH = 1, baseFov = 45, camMode = '';
  const camPos = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
  let menuAng = 0.6;
  let best = {};
  try {
    best = JSON.parse(localStorage.getItem('flugsim_best') || '{}') || {};
  } catch (e) {
    best = {};
  }

  /* ---------- Aufbau ---------- */
  function init() {
    renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(pixelRatio);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 2, 2.5, 90000);
    World.init(scene, renderer);
    World.setWeather('clear');
    ac = new Aircraft(World);
    Model.build(scene, World.cloudTex);
    Panel.init($('pfd'), $('nd'), $('eicas'));
    $('keysMenu').innerHTML = KEYS_HTML;
    $('keysHelp').innerHTML = KEYS_HTML;
    bindUI();
    showBest();
    // Flugzeug fürs Menü auf die Startbahn stellen
    const dep = World.dep;
    ac.reset();
    ac.placeOnGround(dep.thr.x + dep.fx * 70, dep.thr.z + dep.fz * 70, dep.hdg);
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = Math.max(1, view.clientWidth), h = Math.max(1, view.clientHeight);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    viewW = w;
    viewH = h;
    baseFov = clamp(2 * Math.atan(Math.tan((96 * RAD) / 2) / camera.aspect) * DEG, 36, 60);
    camMode = '';
    setCamMode(state !== 'menu' && !extView ? 'cockpit' : 'free');
    const fx = $('fx');
    fx.width = w;
    fx.height = h;
    Panel.resize();
    if (m) drawPanels(true);
  }

  /** Cockpit: Blickachse liegt bei 40 % der Fensterhöhe (mehr Boden, weniger Himmel) */
  function setCamMode(mode) {
    if (mode === camMode) return;
    camMode = mode;
    if (mode === 'cockpit') {
      const k = 1 + 2 * VIEW_SHIFT;
      camera.fov = 2 * Math.atan(Math.tan((baseFov * RAD) / 2) * k) * DEG;
      camera.setViewOffset(viewW, viewH * k, 0, viewH * 2 * VIEW_SHIFT, viewW, viewH);
    } else {
      camera.clearViewOffset();
      camera.fov = baseFov;
    }
    camera.updateProjectionMatrix();
  }

  function showBest() {
    document.querySelectorAll('.diff').forEach((b) => {
      const s = best[b.dataset.diff] || 0;
      b.querySelector('i').textContent = s ? 'Bestleistung: ' + '★'.repeat(s) + '☆'.repeat(3 - s) : '';
    });
  }

  /* ---------- Bedienung ---------- */
  function bindUI() {
    document.querySelectorAll('.diff').forEach((b) => b.addEventListener('click', () => {
      selDiff = b.dataset.diff;
      document.querySelectorAll('.diff').forEach((x) => x.classList.toggle('sel', x === b));
      World.setWeather(DIFF[selDiff].weather);
    }));
    document.querySelectorAll('#scenRow button').forEach((b) => b.addEventListener('click', () => {
      selScen = b.dataset.scen;
      document.querySelectorAll('#scenRow button').forEach((x) => x.classList.toggle('sel', x === b));
    }));
    $('optInvert').addEventListener('change', (e) => { invert = e.target.checked; });
    $('btnStart').addEventListener('click', () => { Snd.init(); startFlight(); });
    $('btnAgain').addEventListener('click', () => { Snd.init(); startFlight(); });
    $('btnMenu').addEventListener('click', toMenu);
    $('btnResume').addEventListener('click', () => setPaused(false));
    $('btnRestart').addEventListener('click', () => { setPaused(false); startFlight(); });
    $('btnQuit').addEventListener('click', () => { setPaused(false); toMenu(); });
    $('btnHelpClose').addEventListener('click', () => setHelp(false));
    $('bPause').addEventListener('click', () => setPaused(true));
    $('bHelp').addEventListener('click', () => setHelp(true));
    $('bView').addEventListener('click', toggleView);
    $('bSound').addEventListener('click', toggleSound);
    $('tabNd').addEventListener('click', () => {
      const on = $('panel').classList.toggle('nd');
      $('tabNd').textContent = on ? 'SYSTEME' : 'KARTE';
      Panel.resize();
      drawPanels(true);
    });

    document.querySelectorAll('.cb[data-act]').forEach((b) => b.addEventListener('click', () => { Snd.init(); action(b.dataset.act); }));
    document.querySelectorAll('.cb[data-hold]').forEach((b) => {
      const k = b.dataset.hold;
      const on = (e) => { e.preventDefault(); hold[k] = true; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (er) { /* egal */ } };
      const off = () => { hold[k] = false; b.classList.remove('held'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
    });

    // Schubhebel
    const track = $('thrTrack');
    let thrId = -1;
    const thrSet = (e) => {
      const r = track.getBoundingClientRect();
      ctl.throttle = clamp(1 - (e.clientY - r.top - 14) / Math.max(1, r.height - 28), 0, 1);
    };
    track.addEventListener('pointerdown', (e) => { e.preventDefault(); thrId = e.pointerId; try { track.setPointerCapture(thrId); } catch (er) { /* egal */ } thrSet(e); });
    track.addEventListener('pointermove', (e) => { if (e.pointerId === thrId) thrSet(e); });
    const thrEnd = (e) => { if (e.pointerId === thrId) thrId = -1; };
    track.addEventListener('pointerup', thrEnd);
    track.addEventListener('pointercancel', thrEnd);

    // Steuerhorn per Maus/Finger im Fenster
    view.addEventListener('pointerdown', (e) => {
      if (state !== 'fly' || paused || e.target.closest('#topBtns')) return;
      if (stick.on) return;
      e.preventDefault();
      const r = view.getBoundingClientRect();
      stick.on = true;
      stick.id = e.pointerId;
      stick.x0 = e.clientX - r.left;
      stick.y0 = e.clientY - r.top;
      stick.x = stick.y = 0;
      stick.r = clamp(Math.min(r.width, r.height) * 0.3, 55, 120);
      try { view.setPointerCapture(e.pointerId); } catch (er) { /* egal */ }
      view.classList.add('drag');
      const el = $('stick');
      el.classList.remove('hidden');
      el.style.left = stick.x0 + 'px';
      el.style.top = stick.y0 + 'px';
      el.style.width = el.style.height = stick.r * 2 + 'px';
      el.style.margin = -stick.r + 'px 0 0 ' + -stick.r + 'px';
    });
    view.addEventListener('pointermove', (e) => {
      if (!stick.on || e.pointerId !== stick.id) return;
      const r = view.getBoundingClientRect();
      stick.x = clamp((e.clientX - r.left - stick.x0) / stick.r, -1, 1);
      stick.y = clamp((e.clientY - r.top - stick.y0) / stick.r, -1, 1);
      $('stickDot').style.transform = 'translate(' + stick.x * stick.r + 'px,' + stick.y * stick.r + 'px)';
    });
    const stickEnd = (e) => {
      if (!stick.on || (e && e.pointerId !== stick.id)) return;
      stick.on = false;
      stick.x = stick.y = 0;
      view.classList.remove('drag');
      $('stick').classList.add('hidden');
      $('stickDot').style.transform = '';
    };
    view.addEventListener('pointerup', stickEnd);
    view.addEventListener('pointercancel', stickEnd);
    view.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b && state !== 'menu') b.blur();
    });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k) && state !== 'menu') e.preventDefault();
      if (keys[k]) return;
      keys[k] = true;
      if (state === 'fly') Snd.init();
      if (k === 'Escape' || k === 'p') {
        if (helpOpen) setHelp(false);
        else if (state === 'fly') setPaused(!paused);
        return;
      }
      if (k === 'm') return toggleSound();
      if (k === 'h' && state === 'fly') return setHelp(!helpOpen);
      if (k === 'Enter' && (state === 'menu' || state === 'result')) {
        const el = document.activeElement;
        if (el && el.tagName === 'BUTTON') return; // der Knopf löst selbst aus
        Snd.init();
        return startFlight();
      }
      if (state !== 'fly' || paused) return;
      const map = { g: 'gear', f: 'flapsDown', r: 'flapsUp', v: 'view', i: 'restart', x: 'emerGear', n: 'emerPower', 1: 'fire1', 2: 'fire2', Enter: 'ack' };
      if (map[k]) action(map[k]);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = false;
    });
    window.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
      if (state === 'fly' && !paused) setPaused(true);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'fly' && !paused) setPaused(true);
    });
  }

  function toggleSound() {
    Snd.init();
    Snd.setMuted(!Snd.muted);
    $('bSound').textContent = Snd.muted ? 'TON AUS' : 'TON AN';
  }
  function toggleView() {
    extView = !extView;
    app.classList.toggle('ext', extView);
    if (extView) camPos.copy(ac.pos).add(tmpV.set(-Math.sin(ac.hdg) * 34, 9, Math.cos(ac.hdg) * 34));
  }
  function setPaused(p) {
    if (state !== 'fly' && p) return;
    paused = p;
    $('pause').classList.toggle('hidden', !p);
    Snd.setActive(!p && state === 'fly');
    last = performance.now();
  }
  function setHelp(h) {
    helpOpen = h;
    $('help').classList.toggle('hidden', !h);
    if (state === 'fly') {
      paused = h;
      Snd.setActive(!h);
      last = performance.now();
    }
  }

  function toast(text, sec) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    m.toastT = sec || 3.5;
  }
  function alertBanner(text, level) {
    const el = $('alert');
    el.textContent = '⚠ ' + text;
    el.classList.toggle('caut', level !== 'warn');
    el.classList.remove('hidden');
    m.alertT = 4.5;
  }

  /** Knopf- und Tastenaktionen */
  function action(a) {
    if (state !== 'fly' || paused || !m) return;
    Snd.play('click');
    switch (a) {
      case 'view':
        toggleView();
        break;
      case 'gear': {
        const down = ac.gearTarget !== 1;
        if (!down && ac.onGround) return toast('Am Boden bleibt das Fahrwerk ausgefahren.');
        if (ac.sys.emerGear) return toast('Notausfahren aktiv – das Fahrwerk bleibt unten.');
        ac.setGear(down);
        if (!ac.sys.hyd || ac.sys.gearJam) toast('Fahrwerk reagiert nicht! Notausfahren: ' + K('X', 'Knopf NOT-FAHRWERK'));
        break;
      }
      case 'flapsDown':
      case 'flapsUp': {
        if (!ac.sys.hyd || ac.sys.flapsJam) return toast('Die Landeklappen sind blockiert.');
        const n = ac.flapsTarget + (a === 'flapsDown' ? 1 : -1);
        if (n < 0 || n > 3) return;
        ac.setFlaps(n);
        if (a === 'flapsDown' && ac.ias * KT > 215) toast('Vorsicht: Klappen erst unter 200 kt ausfahren.');
        break;
      }
      case 'fire1':
      case 'fire2': {
        const i = a === 'fire1' ? 0 : 1, e = ac.eng[i];
        if (!e.fire && e.running) {
          if (m.confirmFire !== i || m.confirmT <= 0) {
            m.confirmFire = i;
            m.confirmT = 2.5;
            return toast('Triebwerk ' + (i + 1) + ' brennt nicht! Zum Abstellen nochmals drücken.');
          }
          m.confirmT = 0;
          ac.fireHandle(i);
          m.wrongShut = true;
          return toast('Triebwerk ' + (i + 1) + ' abgestellt. Neustart: ' + K('I', 'Knopf NEUSTART'));
        }
        if (e.fire && e.bottles <= 0 && e.extT <= 0) return toast('Beide Löschflaschen sind leer!');
        if (!e.fire && !e.running) return toast('Triebwerk ' + (i + 1) + ' ist bereits aus.');
        ac.fireHandle(i);
        break;
      }
      case 'restart':
        if (ac.eng[0].running && ac.eng[1].running) return toast('Beide Triebwerke laufen.');
        if (!ac.restart()) toast(ac.eng.some((e) => e.fire) ? 'Brennendes Triebwerk kann nicht gestartet werden.' : 'Neustart läuft bereits …');
        break;
      case 'emerGear':
        if (ac.sys.hyd && !ac.sys.gearJam) return toast('Fahrwerk funktioniert normal: ' + K('G', 'Knopf FAHRWERK'));
        if (!ac.emergencyGear()) toast('Notausfahren ist bereits aktiv.');
        break;
      case 'emerPower':
        if (ac.sys.elec) return toast('Die Stromversorgung ist normal.');
        if (!ac.emergencyPower()) toast(ac.sys.emerPower ? 'Notstrom ist bereits eingeschaltet.' : 'Notstrom startet …');
        break;
      case 'ack':
        m.masterWarn = false;
        m.masterT = 0;
        break;
    }
  }

  function K(key, alt) {
    return touch ? alt : /Leertaste/.test(key) ? key : 'Taste ' + key;
  }

  /* ---------- Flug starten / beenden ---------- */
  function startFlight() {
    const D = DIFF[selDiff];
    World.setWeather(D.weather);
    ac.reset();
    ac.cfg = Object.assign({}, D.cfg);
    Failures.plan(selDiff, selScen);
    Warn.reset();
    Snd.resetAlarms();
    Model.hideSmoke();
    m = {
      diff: selDiff, scen: selScen, D, t: 0, gateIdx: 0, hit: 0, missed: 0, stopT: 0,
      toastT: 0, alertT: 0, masterWarn: false, masterT: 0, cautT: 0, cracked: false, cracks: null,
      confirmFire: -1, confirmT: 0, wrongShut: false, maxAlt: 0, endKind: null, endT: 0, coachT: 0, lastCoach: '',
      msgs: [], ils: null, blink: true, thunderQ: [],
    };
    env.wind.copy(World.wind);
    env.turb = World.weather.turb;
    env.wet = World.weather.rain > 0;
    ctl.pitch = ctl.roll = ctl.yaw = ctl.brake = 0;
    const dep = World.dep, g = World.gates;
    if (selScen === 'approach') {
      const a = g[4], b = g[5];
      ctl.throttle = 0.44;
      ac.throttle = 0.44;
      ac.placeInAir(a.x, a.y, a.z, Math.atan2(b.x - a.x, -(b.z - a.z)), 88, 0);
      m.gateIdx = 5;
    } else {
      ctl.throttle = 0;
      ac.setFlaps(1);
      ac.flaps = 1;
      ac.placeOnGround(dep.thr.x + dep.fx * 70, dep.thr.z + dep.fz * 70, dep.hdg);
      // Fahrwerk einfedern lassen
      const c0 = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1 };
      const calm = { wind: new THREE.Vector3(), turb: 0, wet: false };
      for (let i = 0; i < 240; i++) ac.step(1 / 120, c0, calm);
      ac.vel.set(0, 0, 0);
      ac.events.length = 0;
      ac.time = 0;
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    extView = false;
    paused = false;
    helpOpen = false;
    shakeImp = 0;
    flashRed = 0;
    state = 'fly';
    app.className = '';
    for (const id of ['menu', 'result', 'pause', 'help', 'alert', 'toast', 'checklist', 'coach', 'marker']) $(id).classList.add('hidden');
    $('panel').classList.remove('nd');
    $('tabNd').textContent = 'KARTE';
    $('hudInfo').innerHTML = '<b>' + D.name + '</b> · ' + (selScen === 'full' ? 'Seeblick → Adlerhorst' : 'Anflug auf Adlerhorst');
    $('flash').style.opacity = 0;
    resize();
    Snd.setActive(true);
    Snd.play('ding');
    last = performance.now();
    updateButtons();
    drawPanels(true);
  }

  function toMenu() {
    state = 'menu';
    m = null;
    paused = false;
    Snd.setActive(false);
    app.className = 'menu';
    for (const id of ['result', 'pause', 'help']) $(id).classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('flash').style.opacity = 0;
    Model.hideSmoke();
    World.showGates(0, false);
    const dep = World.dep;
    ac.reset();
    ac.placeOnGround(dep.thr.x + dep.fx * 70, dep.thr.z + dep.fz * 70, dep.hdg);
    showBest();
    resize();
  }

  function endFlight(kind) {
    if (state !== 'fly') return;
    state = 'ending';
    m.endKind = kind;
    Snd.setActive(false);
    if (Snd.ctx) Snd.sfx.gain.value = 1;
    if (kind === 'crash') {
      Snd.play(ac.crash.cause === 'water' ? 'splash' : 'explosion');
      if (ac.crash.cause === 'water') Snd.play('bang');
      flashRed = 1;
      shakeImp = 3;
      m.endT = 2.3;
    } else if (kind === 'ditch') {
      Snd.play('splash');
      shakeImp = 1.5;
      m.endT = 2.0;
    } else {
      Snd.play('success');
      m.endT = 1.3;
    }
    for (const id of ['alert', 'toast', 'coach', 'marker']) $(id).classList.add('hidden');
  }

  /* ---------- Auswertung ---------- */
  function showResult() {
    state = 'result';
    const kind = m.endKind;
    const fails = Failures.active.map((f) => f.name);
    const stats = [];
    const add = (a, b) => stats.push([a, b]);
    let title, lead, tip, stars = 0, cls = 'good';
    const lastL = ac.landings[ac.landings.length - 1];
    if (kind === 'crash') {
      title = 'ABSTURZ';
      cls = 'bad';
      const c = ac.crash.cause;
      const T = {
        hard: ['Du hast viel zu hart aufgesetzt (' + Math.round((ac.crash.sink || 0) * FT * 60) + ' ft/min) – das Fahrwerk ist gebrochen.',
          'Kurz vor dem Boden den Schub herausnehmen und sanft ziehen (abfangen). Die Sinkrate beim Aufsetzen sollte unter 600 ft/min liegen.'],
        wing: ['Eine Tragfläche hat den Boden berührt.', 'Halte beim Aufsetzen und in Bodennähe die Flügel waagerecht.'],
        nose: ['Das Flugzeug ist mit der Nase voran aufgeschlagen.', 'Achte auf den künstlichen Horizont: Nase nie steil nach unten, wenn der Boden nah ist.'],
        terrain: ['Das Flugzeug ist mit dem Gelände kollidiert.', 'Halte genug Höhe. Rote Flächen im Navigationsdisplay sind höher als du – bei „HOCHZIEHEN!“ sofort ziehen und Vollschub geben.'],
        trees: ['Das Flugzeug ist in den Wald geraten.', 'Außerhalb der Landebahn nur auf freien Wiesen notlanden.'],
        water: ['Das Flugzeug ist ins Wasser gestürzt.', 'Eine Notwasserung gelingt nur flach, langsam, mit eingefahrenem Fahrwerk und waagerechten Flügeln.'],
        building: ['Das Flugzeug ist mit einem Gebäude kollidiert.', 'Bleib beim Rollen auf der Bahn und halte Abstand zu Terminal und Tower.'],
        fire: ['Das Triebwerksfeuer wurde nicht rechtzeitig gelöscht – Explosion.', 'Bei Feueralarm sofort den Feuerlöscher des brennenden Triebwerks auslösen (Taste 1 oder 2).'],
      }[c] || ['Das Flugzeug wurde zerstört.', ''];
      lead = T[0];
      tip = T[1];
      if (ac.stalled || (c === 'terrain' && ac.ias * KT < ac.stallSpeed() * KT + 8)) {
        tip = 'Du warst zu langsam (Strömungsabriss). Bei der Warnung „ÜBERZOGEN“ sofort Nase senken und Vollschub geben. ' + tip;
      }
    } else if (kind === 'ditch') {
      title = 'NOTWASSERUNG GEGLÜCKT';
      cls = 'mid';
      stars = 1;
      lead = 'Du hast das Flugzeug kontrolliert auf dem Wasser aufgesetzt. Alle haben überlebt!';
      tip = 'Stark – aber eine Landebahn ist besser. Achte auf Treibstoff und Entfernung zum Flughafen.';
    } else {
      const surf = lastL ? World.surfaceAt(ac.pos.x, ac.pos.z) : { type: 'grass' };
      const onRw = surf.type === 'runway' || surf.type === 'paved';
      const atDest = onRw && surf.ap === World.dest.ap;
      const beside = !onRw && !!surf.ap;
      const group = ac.landings.filter((l) => l.t > lastL.t - 25);
      const td = group[0];
      const sinkFpm = Math.round(td.sink * FT * 60);
      const maxSink = Math.max.apply(null, group.map((l) => l.sink));
      let score = 0;
      if (atDest) score = 55;
      else if (onRw) score = fails.length ? 50 : 40;
      else score = beside ? 38 : 25;
      score += maxSink < 1.5 ? 20 : maxSink < 2.5 ? 14 : maxSink < 3.5 ? 8 : 2;
      const onCenter = td.surface === 'runway' ? Math.abs(td.lat) : 99;
      score += onCenter < 5 ? 15 : onCenter < 10 ? 10 : onCenter < 17 ? 5 : 0;
      // Aufsetzpunkt hinter der Schwelle (in Landerichtung)
      let tdDist = null;
      if (td.surface === 'runway' && td.ap) {
        const dir = td.vx * td.ap.fx + td.vz * td.ap.fz >= 0 ? 1 : -1;
        tdDist = td.ap.len / 2 + dir * td.along;
        if (tdDist > 0 && tdDist < 900) score += 5;
      }
      if (m.D.gates && m.hit + m.missed > 0) score += Math.round((5 * m.hit) / (m.hit + m.missed));
      else score += 5;
      if (!td.gearDown) score -= 15;
      stars = score >= 88 ? 3 : score >= 70 ? 2 : 1;
      if (atDest) {
        title = stars === 3 ? 'PERFEKTE LANDUNG!' : 'LANDUNG GEGLÜCKT';
        lead = 'Willkommen in Adlerhorst! ' + (fails.length ? 'Trotz Störung hast du das Flugzeug sicher gelandet.' : 'Du hast das Flugzeug sicher gelandet.');
      } else if (onRw) {
        title = 'SICHER GELANDET';
        cls = 'mid';
        lead = 'Du bist in ' + surf.ap.name + ' gelandet' + (fails.length ? ' – bei einem Notfall genau richtig: Hauptsache sicher am Boden.' : '. Das Ziel war Adlerhorst, aber sicher ist sicher.');
      } else if (beside) {
        title = 'NEBEN DER BAHN GELANDET';
        cls = 'mid';
        lead = 'Du bist in ' + surf.ap.name + ' auf dem Rasen neben der Landebahn zum Stehen gekommen. Alle sind wohlauf – das Flugzeug braucht eine Wäsche.';
      } else {
        title = 'NOTLANDUNG ÜBERLEBT';
        cls = 'mid';
        lead = 'Du hast außerhalb eines Flughafens aufgesetzt und das Flugzeug zum Stehen gebracht.';
      }
      if (!td.gearDown) lead += ' Allerdings ohne ausgefahrenes Fahrwerk – eine Bauchlandung!';
      const word = maxSink < 1.5 ? 'butterweich' : maxSink < 2.5 ? 'gut' : maxSink < 3.5 ? 'fest' : 'sehr hart';
      add('Aufsetzen', sinkFpm + ' ft/min (' + word + ')');
      if (td.surface === 'runway') add('Abstand zur Mittellinie', Math.round(Math.abs(td.lat)) + ' m');
      if (tdDist != null && tdDist > 0) add('Aufsetzpunkt', Math.round(tdDist / 10) * 10 + ' m hinter der Schwelle');
      add('Geschwindigkeit beim Aufsetzen', Math.round(td.ias * KT) + ' kt');
      if (group.length > 1) add('Hüpfer', String(group.length - 1));
      add('Punkte', clamp(score, 0, 100) + ' / 100');
      tip = maxSink >= 2.5 ? 'Tipp: Kurz vor dem Aufsetzen den Schub ganz herausnehmen und die Nase leicht anheben – dann setzt du weicher auf.'
        : onCenter >= 10 ? 'Tipp: Schon im Anflug mit kleinen Korrekturen auf die Mittellinie ausrichten (violette Raute unten im Hauptdisplay).'
          : stars === 3 ? (m.diff === 'hard' ? 'Meisterleistung – mehr geht nicht!' : 'Sehr gut! Bereit für die nächste Stufe?')
            : 'Gut gemacht! Für drei Sterne: weich aufsetzen und genau auf der Mittellinie landen.';
      if (stars > (best[m.diff] || 0)) {
        best[m.diff] = stars;
        try {
          localStorage.setItem('flugsim_best', JSON.stringify(best));
        } catch (e) { /* egal */ }
      }
    }
    add('Flugzeit', U.fmtTime(m.t) + ' min');
    if (m.D.gates && m.hit + m.missed > 0) add('Tore getroffen', m.hit + ' von ' + (m.hit + m.missed));
    add('Störungen', fails.length ? fails.join(', ') : 'keine');
    $('resTitle').textContent = title;
    $('resTitle').className = cls;
    $('resStars').innerHTML = kind === 'crash' ? '' : '★'.repeat(stars) + '<s>' + '★'.repeat(3 - stars) + '</s>';
    $('resLead').textContent = lead;
    $('resStats').innerHTML = stats.map((s) => '<span>' + s[0] + '</span><span>' + s[1] + '</span>').join('');
    $('resTip').textContent = tip;
    $('resTip').classList.toggle('hidden', !tip);
    $('result').classList.remove('hidden');
    $('coach').classList.add('hidden');
    $('checklist').classList.add('hidden');
  }

  /* ---------- Eingabe ---------- */
  function readInput(dt) {
    let tp = 0, tr = 0, ty = 0;
    if (keys.ArrowDown) tp += 1;
    if (keys.ArrowUp) tp -= 1;
    if (invert) tp = -tp;
    if (keys.ArrowRight) tr += 1;
    if (keys.ArrowLeft) tr -= 1;
    if (keys.d || hold.rudR) ty += 1;
    if (keys.a || hold.rudL) ty -= 1;
    const ease = (cur, tgt, up, down) => {
      const rate = Math.abs(tgt) > Math.abs(cur) || tgt * cur < 0 ? up : down;
      return cur + clamp(tgt - cur, -rate * dt, rate * dt);
    };
    if (stick.on) {
      const sy = invert ? -stick.y : stick.y;
      // leichte Kurve: feinfühlig um die Mitte
      const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.4);
      ctl.pitch += (curve(sy) - ctl.pitch) * Math.min(1, dt * 14);
      ctl.roll += (curve(stick.x) - ctl.roll) * Math.min(1, dt * 14);
    } else {
      ctl.pitch = ease(ctl.pitch, tp, 3.2, 5.5);
      ctl.roll = ease(ctl.roll, tr, 3.2, 5.5);
    }
    ctl.yaw = ease(ctl.yaw, ty, 1.5, 4);
    if (keys.w) ctl.throttle = clamp(ctl.throttle + dt * 0.45, 0, 1);
    if (keys.s) ctl.throttle = clamp(ctl.throttle - dt * 0.45, 0, 1);
    ctl.brake = keys[' '] || hold.brake ? 1 : 0;
  }

  /* ---------- Simulation ---------- */
  function simulate(dt) {
    if (!FS.game.auto) readInput(dt);
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      ac.step(h, ctl, env);
      if (ac.crash || ac.ditch) break;
    }
    m.t += dt;
    m.maxAlt = Math.max(m.maxAlt, ac.pos.y);
    if (!ac.sys.pitot) {
      const tgt = 22 + 13 * Math.sin(m.t * 0.37);
      ac.sys.pitotVal += (tgt - ac.sys.pitotVal) * Math.min(1, dt * 0.12);
    }

    // Störungen
    for (const f of Failures.update(dt, ac)) onFailure(f);
    Warn.update(dt, ac, World);
    Warn.w.cracked = m.cracked;
    handleEvents();

    // Tore / Wegpunkte
    const g = World.gates;
    while (m.gateIdx < g.length) {
      const gt = g[m.gateIdx];
      const dx = ac.pos.x - gt.x, dz = ac.pos.z - gt.z;
      if (dx * gt.dx + dz * gt.dz <= 0) break;
      const d3 = Math.hypot(dx, dz, ac.pos.y - gt.y);
      if (d3 < 125) {
        m.hit++;
        if (m.D.gates) Snd.play('gate');
      } else m.missed++;
      m.gateIdx++;
    }

    // Zeitgeber
    if (m.masterT > 0) {
      m.masterT -= dt;
      if (m.masterT <= 0) m.masterWarn = false;
    }
    if (m.confirmT > 0) m.confirmT -= dt;
    if (m.toastT > 0) {
      m.toastT -= dt;
      if (m.toastT <= 0) $('toast').classList.add('hidden');
    }
    if (m.alertT > 0) {
      m.alertT -= dt;
      if (m.alertT <= 0) $('alert').classList.add('hidden');
    }
    for (let i = m.thunderQ.length - 1; i >= 0; i--) {
      m.thunderQ[i] -= dt;
      if (m.thunderQ[i] <= 0) {
        Snd.play('thunder');
        m.thunderQ.splice(i, 1);
      }
    }

    // Ende?
    if (ac.crash) return endFlight('crash');
    if (ac.ditch) return endFlight('ditch');
    if (ac.hasFlown && ac.onGround && ac.landings.length && ac.gs < 1.3) {
      m.stopT += dt;
      if (m.stopT > 1.1) return endFlight('landed');
    } else m.stopT = 0;
  }

  function onFailure(f) {
    alertBanner(f.title, f.level);
    $('panel').classList.remove('nd');
    $('tabNd').textContent = 'KARTE';
    if (f.level === 'warn') {
      m.masterWarn = true;
      m.masterT = 14;
    }
    switch (f.fx) {
      case 'bang':
        Snd.play('bang');
        shakeImp = 1.6;
        break;
      case 'fire':
        Snd.play('warning');
        shakeImp = 0.8;
        break;
      case 'bird':
        Snd.play('bird');
        Snd.play('bang');
        shakeImp = 2;
        m.cracked = true;
        makeCracks();
        break;
      case 'elec':
        Snd.play('powerDown');
        if (World.weather.lightning) {
          World.flash = 1.4;
          Snd.play('thunder');
          Snd.play('bang');
          shakeImp = 1.5;
        }
        break;
      default:
        Snd.play('caution');
    }
  }

  function handleEvents() {
    for (const ev of ac.events) {
      switch (ev.type) {
        case 'touchdown':
          Snd.play('touchdown', ev.rec.sink);
          shakeImp = Math.max(shakeImp, clamp(ev.rec.sink / 3, 0.3, 2));
          break;
        case 'wheel':
          if (ev.sink > 0.4) Snd.play('touchdown', ev.sink * 0.6);
          shakeImp = Math.max(shakeImp, clamp(ev.sink / 4, 0, 1));
          break;
        case 'gearLock':
        case 'gearUp':
          Snd.play('gearLock');
          break;
        case 'extinguisher':
          Snd.play('hiss');
          toast('Feuerlöscher Triebwerk ' + (ev.i + 1) + ' ausgelöst …');
          break;
        case 'fireOut':
          Snd.play('ding');
          toast('Feuer in Triebwerk ' + (ev.i + 1) + ' gelöscht!');
          break;
        case 'fireStill':
          toast('Es brennt weiter! Nochmals löschen: ' + K(String(ev.i + 1), 'Knopf FEUER ' + (ev.i + 1)), 5);
          Snd.play('warning');
          break;
        case 'restartBegin':
          toast('Neustart Triebwerk ' + (ev.i + 1) + ' …');
          break;
        case 'restartOK':
          Snd.play('ding');
          toast('Triebwerk ' + (ev.i + 1) + ' läuft wieder!');
          break;
        case 'restartFail':
          Snd.play('caution');
          toast('Neustart fehlgeschlagen – Triebwerk ' + (ev.i + 1) + ' bleibt aus.', 4.5);
          break;
        case 'fuelOut':
          alertBanner('TREIBSTOFF LEER – TRIEBWERKE AUS', 'warn');
          m.masterWarn = true;
          m.masterT = 12;
          Snd.play('warning');
          break;
        case 'emerGear':
          toast('Notausfahren: Das Fahrwerk fällt durch sein Gewicht heraus …', 4.5);
          break;
        case 'emerPowerBegin':
          toast('Notstrom startet …');
          break;
        case 'emerPowerOn':
          Snd.play('powerUp');
          toast('Notstrom ein – Hauptdisplay wieder verfügbar.');
          break;
      }
    }
    ac.events.length = 0;
  }

  /* ---------- Tipps ---------- */
  function coachText() {
    if (!m.D.coach) return '';
    const kt = ac.ias * KT, ra = ac.ra;
    const pullKey = K(invert ? '↑' : '↓', invert ? 'im Fenster nach oben ziehen' : 'im Fenster nach unten ziehen');
    const dest = World.dest;
    const dDest = Math.hypot(ac.pos.x - dest.thr.x, ac.pos.z - dest.thr.z);
    const fl = ac.sys.hyd && !ac.sys.flapsJam;
    if (!ac.hasFlown) {
      if (ac.flapsTarget < 1 && fl) return 'Klappen auf Stufe 1 setzen: ' + K('F', 'Knopf KLAPPEN ▼');
      if (ac.throttle < 0.85 && ac.gs < 35) return 'Bereit zum Start! Vollen Schub geben: ' + K('W gedrückt halten', 'Schubhebel ganz nach oben');
      if (kt < 112) return 'Auf der Bahnmitte bleiben (' + K('← →', 'links/rechts ziehen') + ') · Abheben bei 120 kt';
      return 'Abheben! Sanft ziehen: ' + pullKey;
    }
    if (ac.onGround) {
      if (ac.gs > 2) return 'Gelandet! Schub raus und bremsen: ' + K('Leertaste halten', 'Knopf BREMSE halten');
      return '';
    }
    const landing = dDest < 14500 || m.gateIdx >= 6;
    if (!landing) {
      if (ra > 25 && ac.gearTarget === 1 && !ac.sys.emerGear && ac.airT > 3 && m.t < 150) return 'Fahrwerk einfahren: ' + K('G', 'Knopf FAHRWERK');
      if (kt > 150 && ac.flapsTarget > 0 && fl && ra > 120) return 'Klappen einfahren: ' + K('R', 'Knopf KLAPPEN ▲');
      if (m.gateIdx < 3) return 'Steigflug: Nase etwa 10° hoch' + (m.D.gates ? ', den grünen Toren folgen' : '');
      if (kt > 245) return 'Reiseflug: Schub auf etwa 45 % zurücknehmen (' + K('S', 'Schubhebel') + ')';
      return (m.D.gates ? 'Den Toren folgen' : 'Kurs halten') + ' · Höhe 3000 ft · Tempo etwa 220 kt';
    }
    // Landeanflug
    if (ra < 12 && ac.vs < 0) return 'Schub ganz raus (' + K('S', 'Schubhebel') + ') und sanft abfangen: ' + pullKey;
    if (kt > 200) return 'Landeanflug: Schub stark reduzieren (' + K('S', 'Schubhebel nach unten') + ') – Ziel 160 kt';
    if (fl && ac.flapsTarget < 1) return 'Klappen Stufe 1 ausfahren: ' + K('F', 'Knopf KLAPPEN ▼');
    if (dDest < 10500) {
      if (fl && ac.flapsTarget < 2 && kt < 190) return 'Klappen Stufe 2 ausfahren: ' + K('F', 'Knopf KLAPPEN ▼');
      const gearDown = ac.gearTarget === 1 || ac.sys.emerGear;
      if (!gearDown) return (ac.sys.hyd && !ac.sys.gearJam) ? 'Fahrwerk ausfahren: ' + K('G', 'Knopf FAHRWERK') : 'Fahrwerk per Notausfahren: ' + K('X', 'Knopf NOT-FAHRWERK');
      if (dDest < 7500 && fl && ac.flapsTarget < 3 && kt < 170) return 'Klappen voll ausfahren: ' + K('F', 'Knopf KLAPPEN ▼');
    }
    if (kt < ac.stallSpeed() * KT + 14) return 'Zu langsam! Mehr Schub geben (' + K('W', 'Schubhebel') + ')';
    if (m.ils && Math.abs(m.ils.gs) > 0.45 && m.ils.gsValid) return m.ils.gs > 0 ? 'Du bist zu hoch – Schub reduzieren, Nase etwas senken' : 'Du bist zu tief – Schub geben, Nase etwas anheben';
    return 'Anflug mit ' + (fl ? '125' : '140') + ' kt · den violetten Rauten folgen · PAPI-Lichter links der Bahn: 2 weiß + 2 rot = perfekt';
  }

  /* ---------- HUD ---------- */
  function updateHud(dt) {
    // Wegweiser
    const mk = $('marker');
    const g = World.gates, dest = World.dest;
    let tx, tz, label;
    if (m.gateIdx < g.length) {
      const gt = g[m.gateIdx];
      tx = gt.x;
      tz = gt.z;
      label = (m.D.gates ? 'TOR ' + (m.gateIdx + 1) : 'WEGPUNKT ' + (m.gateIdx + 1)) + ' · ';
      m.tgtAlt = gt.y;
    } else {
      tx = dest.thr.x;
      tz = dest.thr.z;
      label = 'LANDEBAHN ' + dest.id + ' · ';
      m.tgtAlt = null;
    }
    const brg = Math.atan2(tx - ac.pos.x, -(tz - ac.pos.z));
    const rel = U.wrapPi(brg - ac.hdg);
    m.wpBrg = brg;
    const dist = Math.hypot(tx - ac.pos.x, tz - ac.pos.z);
    m.destDist = Math.hypot(dest.thr.x - ac.pos.x, dest.thr.z - ac.pos.z);
    if (state === 'fly' && (ac.hasFlown || m.scen === 'approach') && !ac.onGround) {
      const hf = Math.min(0.85, Math.atan(Math.tan((baseFov * RAD) / 2) * camera.aspect));
      const k = clamp(Math.tan(clamp(rel, -1.4, 1.4)) / Math.tan(hf), -1, 1);
      const off = Math.abs(rel) > hf;
      let s = label + (dist / 1000).toFixed(1) + ' km';
      if (m.tgtAlt != null) s += ' · ' + Math.round((m.tgtAlt * FT) / 50) * 50 + ' ft';
      if (off) s = rel < 0 ? '◄ ' + s : s + ' ►';
      mk.textContent = s;
      mk.style.left = 50 + k * 38 + '%';
      mk.classList.toggle('off', off);
      mk.classList.remove('hidden');
    } else mk.classList.add('hidden');

    // Tipps
    m.coachT -= dt;
    if (m.coachT <= 0) {
      m.coachT = 0.4;
      const c = state === 'fly' ? coachText() : '';
      if (c !== m.lastCoach) {
        m.lastCoach = c;
        $('coach').textContent = c;
        $('coach').classList.toggle('hidden', !c);
      }
      updateChecklist();
      updateButtons();
    }
  }

  function updateChecklist() {
    const el = $('checklist');
    const act = Failures.active;
    if (!act.length || state !== 'fly') return el.classList.add('hidden');
    const f = act[act.length - 1];
    const compact = view.clientHeight < 300;
    let html = '<h4>' + (compact ? '' : 'CHECKLISTE: ') + f.title + '</h4>';
    let steps = f.steps.map((s) => ({ text: typeof s.t === 'function' ? s.t() : s.t, done: s.done ? s.done() : null }));
    if (compact) steps = steps.filter((s) => s.done !== true).slice(0, 2);
    for (const s of steps) {
      let text = s.text;
      const done = s.done;
      if (touch) {
        text = text.replace(/Taste ([12])/g, 'Knopf FEUER $1').replace('Taste I', 'Knopf NEUSTART').replace('Taste X', 'Knopf NOT-FAHRWERK')
          .replace('Taste N', 'Knopf NOTSTROM').replace('(A / D)', '(Knöpfe ◄ RUDER ►)');
      }
      html += '<div class="st ' + (done === true ? 'done' : done === false ? 'todo' : '') + '"><i>' + (done === true ? '✔' : done === false ? '▶' : '•') + '</i><span>' + text + '</span></div>';
    }
    if (act.length > 1 && !compact) html += '<div class="more">Außerdem: ' + act.slice(0, -1).map((x) => x.name).join(' · ') + '</div>';
    if (html !== m.clHtml) {
      m.clHtml = html;
      el.innerHTML = html;
    }
    el.classList.toggle('warn', f.level === 'warn');
    el.classList.remove('hidden');
  }

  function updateButtons() {
    if (!m) return;
    const gb = $('cbGear');
    const dn = ac.gear[1] > 0.99 && ac.gear[2] > 0.99 && ac.gear[0] > 0.99, up = ac.gear[0] < 0.01 && ac.gear[1] < 0.01 && ac.gear[2] < 0.01;
    gb.classList.toggle('on', dn);
    gb.classList.toggle('transit', !dn && !up);
    gb.firstChild.textContent = dn ? 'FAHRWERK ▼' : up ? 'FAHRWERK ▲' : 'FAHRWERK …';
    $('cbFire1').classList.toggle('need', ac.eng[0].fire);
    $('cbFire1').classList.toggle('lit', ac.eng[0].fire);
    $('cbFire2').classList.toggle('need', ac.eng[1].fire);
    $('cbFire2').classList.toggle('lit', ac.eng[1].fire);
    $('cbAck').classList.toggle('lit', m.masterWarn);
    $('cbAck').classList.toggle('need', m.masterWarn);
    const canRestart = ac.eng.some((e) => !e.running && !e.fire && !e.burnt && e.restartT <= 0 && !e.tried);
    $('cbRestart').classList.toggle('need', canRestart && ac.fuel > 0);
    const needGear = (!ac.sys.hyd || ac.sys.gearJam) && !ac.sys.emerGear && (ac.gearTarget === 1 || m.destDist < 11000);
    $('cbEmerGear').classList.toggle('need', needGear);
    $('cbEmerGear').classList.toggle('on', ac.sys.emerGear);
    $('cbEmerPower').classList.toggle('need', !ac.sys.elec && !ac.sys.emerPower && ac.sys.emerPowerT <= 0);
    $('cbEmerPower').classList.toggle('on', ac.sys.emerPower);
    const t = ctl.throttle;
    $('thrHandle').style.bottom = 'calc(' + t + ' * (100% - 28px))';
    $('thrFill').style.height = t * 100 + '%';
    $('thrVal').textContent = Math.round(t * 100) + '%';
  }

  /* ---------- Effekte auf der Frontscheibe ---------- */
  const drops = [];
  function makeCracks() {
    const cx = 0.6 + Math.random() * 0.1, cy = 0.36 + Math.random() * 0.1;
    const lines = [];
    for (let i = 0; i < 13; i++) {
      let a = (i / 13) * Math.PI * 2 + Math.random() * 0.4, x = cx, y = cy;
      const pts = [[x, y]];
      const len = 4 + Math.floor(Math.random() * 5);
      for (let k = 0; k < len; k++) {
        a += (Math.random() - 0.5) * 0.7;
        const st = 0.018 + Math.random() * 0.03;
        x += Math.cos(a) * st * 0.6;
        y += Math.sin(a) * st;
        pts.push([x, y]);
      }
      lines.push(pts);
    }
    for (let r = 1; r <= 2; r++) {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2, rr = r * 0.022 * (0.8 + Math.random() * 0.5);
        pts.push([cx + Math.cos(a) * rr * 0.6, cy + Math.sin(a) * rr]);
      }
      lines.push(pts);
    }
    m.cracks = { cx, cy, lines };
  }

  function drawFx(dt) {
    const c = $('fx'), g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!m || extView) return;
    // Regen
    if (World.weather.rain > 0 && state !== 'menu') {
      const want = 110;
      while (drops.length < want) drops.push({ x: Math.random(), y: Math.random(), l: 0.02 + Math.random() * 0.05, s: 0.6 + Math.random() * 0.8 });
      const v = clamp(ac.tas / 90, 0, 1.4);
      g.strokeStyle = 'rgba(205,222,240,0.34)';
      g.lineWidth = 1.2;
      g.beginPath();
      for (const d of drops) {
        // am Boden: von oben nach unten, im Flug: strahlenförmig vom Fluchtpunkt
        let dx = (d.x - 0.5) * v * 1.6, dy = (d.y - 0.42) * v * 1.6 + (1 - Math.min(1, v)) * 0.9;
        const len = Math.hypot(dx, dy) || 1;
        const sp = (0.5 + v * 1.4) * d.s;
        d.x += (dx / len) * sp * dt;
        d.y += (dy / len) * sp * dt;
        if (d.x < -0.05 || d.x > 1.05 || d.y < -0.05 || d.y > 0.95) {
          d.x = v > 0.4 ? 0.5 + (Math.random() - 0.5) * 0.7 : Math.random();
          d.y = v > 0.4 ? 0.42 + (Math.random() - 0.5) * 0.5 : -0.04;
        }
        g.moveTo(d.x * W, d.y * H);
        g.lineTo((d.x - (dx / len) * d.l) * W, (d.y - (dy / len) * d.l) * H);
      }
      g.stroke();
    }
    // Risse (Vogelschlag)
    if (m.cracks) {
      const k = m.cracks;
      const gr = g.createRadialGradient(k.cx * W, k.cy * H, 0, k.cx * W, k.cy * H, H * 0.16);
      gr.addColorStop(0, 'rgba(235,240,245,0.5)');
      gr.addColorStop(0.3, 'rgba(120,20,20,0.28)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(245,248,252,0.85)';
      g.lineWidth = 1.3;
      g.beginPath();
      for (const pts of k.lines) {
        g.moveTo(pts[0][0] * W, pts[0][1] * H);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] * W, pts[i][1] * H);
      }
      g.stroke();
    }
  }

  /* ---------- Kamera ---------- */
  function updateCamera(dt) {
    setCamMode(state !== 'menu' && !extView ? 'cockpit' : 'free');
    if (state === 'menu') {
      menuAng += dt * 0.045;
      const A = World.airports[0];
      camera.position.set(A.x - 700 + Math.cos(menuAng) * 1500, A.elev + 190 + Math.sin(menuAng * 0.7) * 50, A.z + Math.sin(menuAng) * 1500);
      camera.lookAt(A.x - 600, A.elev + 10, A.z);
      return;
    }
    shakeImp = Math.max(0, shakeImp - dt * (1.2 + shakeImp * 1.5));
    let sh = shakeImp * 0.012 + ac.shakeGround * 0.0035;
    if (ac.stallWarn && !ac.onGround) sh += 0.006;
    sh += clamp(ac.gust.length() * 0.0005, 0, 0.004);
    if (ac.eng[0].fire || ac.eng[1].fire) sh += 0.0012;
    if (extView) {
      const fx = Math.sin(ac.hdg), fz = -Math.cos(ac.hdg);
      tmpV.set(ac.pos.x - fx * 34, ac.pos.y + 8.5, ac.pos.z - fz * 34);
      const gh = Math.max(0, World.heightAt(tmpV.x, tmpV.z)) + 2.5;
      if (tmpV.y < gh) tmpV.y = gh;
      camPos.lerp(tmpV, 1 - Math.exp(-dt * 3.5));
      camera.position.copy(camPos);
      camera.lookAt(ac.pos.x + fx * 14, ac.pos.y + 2, ac.pos.z + fz * 14);
    } else {
      tmpV.set(-0.45, 1.15, -8.6).applyQuaternion(ac.quat);
      camera.position.copy(ac.pos).add(tmpV);
      camera.quaternion.copy(ac.quat);
    }
    if (sh > 0) {
      tmpE.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh * 0.6, (Math.random() - 0.5) * sh * 0.8);
      camera.quaternion.multiply(tmpQ.setFromEuler(tmpE));
    }
  }

  function drawPanels(all) {
    if (!m) return;
    const st = {
      ac, warn: Warn.w, ils: m.ils, msgs: m.msgs, blink: m.blink, world: World,
      pfdOn: ac.sys.elec || ac.sys.emerPower,
      ndOn: ac.sys.elec,
      pitotOK: ac.sys.pitot,
      iasDisp: (ac.sys.pitot ? ac.ias : ac.sys.pitotVal) * KT,
      wpBrg: m.wpBrg, gates: World.gates, gateIdx: m.gateIdx, dest: World.dest, destDist: m.destDist,
      ndRange: m.destDist != null && m.destDist < 9000 ? 6000 : 12000,
      wind: env.wind,
    };
    if (all) Panel.drawAll(st);
    else Panel.draw(st, frameNo);
  }

  /* ---------- Hauptschleife ---------- */
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    // Leistung anpassen
    if (dt > 0.034 && dt < 0.25) {
      slowT += dt;
      if (slowT > 2.5 && pixelRatio > 0.75) {
        pixelRatio = pixelRatio > 1 ? 1 : 0.75;
        slowT = 0;
        resize();
      }
    } else slowT = Math.max(0, slowT - dt * 0.5);
    const realDt = Math.min(dt, 0.3);
    dt = Math.min(dt, 0.1);
    frameNo++;

    if (state === 'fly' && !paused) simulate(dt);
    else if (state === 'ending') {
      m.endT -= realDt;
      if (m.endKind !== 'crash') {
        // ausrollen lassen
        const n = Math.ceil(dt * 120);
        for (let i = 0; i < n && !ac.crash && !ac.ditch; i++) ac.step(dt / n, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 1 }, env);
        ac.events.length = 0;
      }
      if (m.endT <= 0) showResult();
    }

    updateCamera(dt);
    const ev = World.update(paused ? 0 : dt, camera.position, ac.pos);
    if (ev.lightning != null && m && state === 'fly' && !paused) m.thunderQ.push(ev.lightning);
    const inFlight = state === 'fly' || state === 'ending' || state === 'result';
    Model.update(paused ? 0 : dt, ac, state === 'menu' || (inFlight && extView), env.wind);
    World.showGates(m ? m.gateIdx : 0, !!m && m.D.gates && state === 'fly');
    renderer.render(scene, camera);

    // Blitz / roter Einschlag
    const fl = $('flash');
    if (flashRed > 0) {
      flashRed = Math.max(0, flashRed - dt * 0.55);
      fl.style.background = '#ff3b1f';
      fl.style.opacity = Math.min(0.85, flashRed);
    } else if (World.flash > 0 && state !== 'menu') {
      fl.style.background = '#eaf2ff';
      fl.style.opacity = Math.min(0.55, World.flash * 0.45);
    } else if (fl.style.opacity !== '0') fl.style.opacity = '0';

    if (!m) return;
    if (state === 'fly' && !paused) {
      m.blink = Math.floor(now / 280) % 2 === 0;
      m.ils = ac.sys.elec || ac.sys.emerPower ? World.ilsFor(ac.pos, World.dest, ac.onGround ? ac.hdg : ac.track) : null;
      if (frameNo % 3 === 0) m.msgs = Failures.messages(ac, Warn.w);
      updateHud(dt);
      drawPanels(false);
      if (frameNo % 2 === 0) {
        const t = ctl.throttle;
        $('thrHandle').style.bottom = 'calc(' + t + ' * (100% - 28px))';
        $('thrFill').style.height = t * 100 + '%';
        $('thrVal').textContent = Math.round(t * 100) + '%';
      }
      Snd.update(dt, { ac, warn: Warn.w, masterWarn: m.masterWarn, rainOn: World.weather.rain > 0 });
    }
    if (inFlight) drawFx(paused ? 0 : dt);
  }

  // Zugriff für Tests
  FS.game = {
    get ac() { return ac; },
    get m() { return m; },
    get state() { return state; },
    ctl, env, keys,
    start(diff, scen) {
      selDiff = diff || 'easy';
      selScen = scen || 'full';
      startFlight();
    },
    action, toMenu,
    setPaused,
    auto: false,
    /** Test: Spiellogik ohne Grafik weiterrechnen */
    tick(dt) {
      if (state !== 'fly') return state;
      simulate(dt);
      if (state === 'fly') {
        m.msgs = Failures.messages(ac, Warn.w);
        updateHud(dt);
        Snd.update(dt, { ac, warn: Warn.w, masterWarn: m.masterWarn, rainOn: World.weather.rain > 0 });
      }
      return state;
    },
  };

  if (typeof THREE === 'undefined') {
    document.body.innerHTML = '<p style="padding:24px;font:16px sans-serif;color:#fff">Die 3D-Bibliothek konnte nicht geladen werden.</p>';
  } else {
    try {
      init();
    } catch (e) {
      console.error(e);
      const d = document.createElement('p');
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99;margin:0;padding:14px;background:#7a1f1a;color:#fff;font:14px sans-serif';
      d.textContent = 'Der Simulator konnte nicht gestartet werden (3D-Grafik/WebGL nicht verfügbar?): ' + e.message;
      document.body.appendChild(d);
    }
  }
})();
