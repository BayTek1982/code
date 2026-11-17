/* Flugsimulator – Flugzeugmodell für die Außenansicht, Rauch und Feuer */
(function () {
  'use strict';
  const FS = window.FS;

  const Model = {
    group: null,
    legs: [],
    smoke: [],
    emitT: 0,

    build(scene, cloudTex) {
      const g = new THREE.Group();
      const white = new THREE.MeshLambertMaterial({ color: 0xf2f4f7 });
      const blue = new THREE.MeshLambertMaterial({ color: 0x1b4f96 });
      const dark = new THREE.MeshLambertMaterial({ color: 0x23282f });
      const gray = new THREE.MeshLambertMaterial({ color: 0x98a2ad });
      const add = (geo, mat, x, y, z, rx, rz) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        if (rx) m.rotation.x = rx;
        if (rz) m.rotation.z = rz;
        g.add(m);
        return m;
      };
      // Rumpf
      add(new THREE.CapsuleGeometry(1.45, 16, 6, 16), white, 0, 0, -1, Math.PI / 2);
      add(new THREE.ConeGeometry(1.42, 5.2, 16), white, 0, 0.25, 10.6, Math.PI / 2);
      add(new THREE.BoxGeometry(2.3, 0.62, 1.5), dark, 0, 0.72, -9.3); // Cockpitfenster
      add(new THREE.BoxGeometry(2.96, 0.34, 15.5), blue, 0, 0.1, -0.5); // Zierstreifen
      // Tragflächen
      add(new THREE.BoxGeometry(27, 0.3, 3.5), white, 0, -0.8, 0.9);
      add(new THREE.BoxGeometry(0.25, 1.5, 1.6), blue, -13.4, 0, 1.6);
      add(new THREE.BoxGeometry(0.25, 1.5, 1.6), blue, 13.4, 0, 1.6);
      // Triebwerke
      this.engPos = [new THREE.Vector3(-4.2, -1.6, -0.4), new THREE.Vector3(4.2, -1.6, -0.4)];
      for (const p of this.engPos) {
        add(new THREE.CylinderGeometry(0.98, 0.84, 3.7, 14), gray, p.x, p.y, p.z, Math.PI / 2);
        add(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 14), dark, p.x, p.y, p.z - 1.86, Math.PI / 2);
        add(new THREE.BoxGeometry(0.3, 0.7, 2.2), white, p.x, p.y + 0.75, p.z + 0.4);
      }
      // Leitwerk
      add(new THREE.BoxGeometry(0.32, 4.8, 3.6), blue, 0, 3.2, 10.4);
      add(new THREE.BoxGeometry(9.8, 0.24, 2.3), white, 0, 1.15, 11.0);
      // Fahrwerk
      const legAt = [[0, -7.0], [-2.8, 1.0], [2.8, 1.0]];
      for (const [x, z] of legAt) {
        const leg = new THREE.Group();
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.5, 8), gray);
        strut.position.y = -0.75;
        leg.add(strut);
        for (const dx of [-0.28, 0.28]) {
          const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.26, 12), dark);
          wh.rotation.z = Math.PI / 2;
          wh.position.set(dx, -1.45, 0);
          leg.add(wh);
        }
        leg.position.set(x, -0.45, z);
        g.add(leg);
        this.legs.push(leg);
      }
      g.visible = false;
      scene.add(g);
      this.group = g;

      // Rauch
      for (let i = 0; i < 44; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0x30302e, transparent: true, depthWrite: false, opacity: 0 }));
        sp.visible = false;
        scene.add(sp);
        this.smoke.push({ sp, age: 9, life: 1, vel: new THREE.Vector3() });
      }
      this.fireSprites = this.engPos.map(() => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0xff7a18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
        sp.visible = false;
        sp.scale.set(5, 5, 1);
        scene.add(sp);
        return sp;
      });
      this._v = new THREE.Vector3();
    },

    hideSmoke() {
      for (const s of this.smoke) {
        s.age = 99;
        s.sp.visible = false;
      }
      for (const f of this.fireSprites) f.visible = false;
    },

    /** Position/Lage übernehmen, Fahrwerk, Rauch */
    update(dt, ac, visible, wind) {
      const g = this.group;
      g.visible = visible;
      g.position.copy(ac.pos);
      g.quaternion.copy(ac.quat);
      for (let j = 0; j < 3; j++) {
        this.legs[j].visible = ac.gear[j] > 0.03;
        this.legs[j].scale.y = Math.max(0.05, ac.gear[j]);
      }
      // Rauch erzeugen
      this.emitT -= dt;
      const emit = this.emitT <= 0;
      if (emit) this.emitT = 0.045;
      for (let i = 0; i < 2; i++) {
        const e = ac.eng[i];
        const smoking = e.fire || (!e.running && e.egt > 330);
        const fs = this.fireSprites[i];
        fs.visible = visible && e.fire;
        if (e.fire) {
          fs.position.copy(this._v.copy(this.engPos[i]).applyQuaternion(ac.quat).add(ac.pos));
          const k = 4 + Math.random() * 3;
          fs.scale.set(k, k, 1);
        }
        if (smoking && emit && visible) {
          const s = this.smoke.find((q) => q.age >= q.life);
          if (s) {
            s.age = 0;
            s.life = 1.6 + Math.random() * 1.2;
            s.dark = e.fire;
            s.sp.position.copy(this._v.copy(this.engPos[i]).applyQuaternion(ac.quat).add(ac.pos));
            s.vel.set(wind.x + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, wind.z + (Math.random() - 0.5) * 3);
            s.sp.material.color.set(e.fire ? 0x262422 : 0x8a8f94);
          }
        }
      }
      for (const s of this.smoke) {
        if (s.age >= s.life) {
          if (s.sp.visible) s.sp.visible = false;
          continue;
        }
        s.age += dt;
        const t = s.age / s.life;
        s.sp.visible = visible;
        s.sp.position.addScaledVector(s.vel, dt);
        const k = 3 + t * 22;
        s.sp.scale.set(k, k, 1);
        s.sp.material.opacity = (1 - t) * 0.75;
      }
    },
  };

  FS.Model = Model;
})();
