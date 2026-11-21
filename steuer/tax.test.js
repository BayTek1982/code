// Ausführen mit: node --test steuer/tax.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Tax = require('./tax.js');

const person = (o) => ({ krankengeld: true, kirche: false, ...o });

test('Grundfreibetrag bleibt steuerfrei', () => {
  assert.equal(Tax.grundtarif(2025, 12096), 0);
  assert.equal(Tax.grundtarif(2024, 11784), 0);
  assert.ok(Tax.grundtarif(2025, 12200) > 0);
});

test('Tarifzonen gehen stetig ineinander über', () => {
  for (const jahr of [2024, 2025]) {
    const t = Tax.JAHRE[jahr].tarif;
    for (const grenze of [t.e1, t.e2, t.e3]) {
      const sprung = Tax.grundtarif(jahr, grenze + 1) - Tax.grundtarif(jahr, grenze);
      assert.ok(sprung >= 0 && sprung <= 1, `${jahr} bei ${grenze}: Sprung ${sprung}`);
    }
  }
});

test('Tarifwerte 2025', () => {
  assert.equal(Tax.grundtarif(2025, 40000), 7320);
  assert.equal(Tax.grundtarif(2025, 100000), 31088);
  assert.equal(Tax.grundtarif(2025, 300000), 115753);
});

test('Splitting verdoppelt die Steuer des halben Einkommens', () => {
  assert.equal(Tax.tarif(2025, 80000, true, 0), 2 * Tax.grundtarif(2025, 40000));
});

test('Progressionsvorbehalt erhöht die Steuer, besteuert den Lohnersatz aber nicht voll', () => {
  const ohne = Tax.tarif(2025, 30000, false, 0);
  const mit = Tax.tarif(2025, 30000, false, 10000);
  assert.ok(mit > ohne);
  assert.ok(mit < Tax.grundtarif(2025, 40000));
});

test('Soli: Freigrenze und Milderungszone', () => {
  assert.equal(Tax.soli(2025, 19950, false), 0);
  assert.equal(Tax.soli(2025, 20950, false), 119);
  assert.equal(Tax.soli(2025, 100000, false), 5500);
  assert.equal(Tax.soli(2025, 39900, true), 0);
});

test('Werbungskosten: Pauschbetrag und Entfernungspauschale', () => {
  assert.equal(Tax.werbungskosten(person({ brutto: 40000 })).angesetzt, 1230);
  const wk = Tax.werbungskosten(person({ brutto: 40000, km: 30, tage: 200 }));
  assert.equal(wk.fahrt, 1960);
  assert.equal(wk.angesetzt, 1960);
  assert.equal(Tax.werbungskosten(person({ brutto: 40000, hoTage: 300 })).homeoffice, 1260);
});

test('Zumutbare Belastung wird stufenweise berechnet', () => {
  assert.equal(Tax.zumutbareBelastung(60000, false, 0), 15340 * 0.05 + 35790 * 0.06 + 8870 * 0.07);
});

test('Beispiel ledig: Erstattung entspricht gezahlter minus festgesetzter Steuer', () => {
  const e = Tax.berechne({
    jahr: 2025, veranlagung: 'single', kistSatz: 9,
    p: [person({ brutto: 45000, lohnsteuer: 6500, rvAN: 4185, rvAG: 4185, kv: 3800, pv: 800, av: 585, km: 25, tage: 210 })],
  });
  assert.equal(e.pers[0].wk.angesetzt, 210 * (6 + 5 * 0.38));
  assert.equal(e.altersvorsorge, 4185);
  assert.equal(e.krankenvorsorge, 3800 * 0.96 + 800);
  assert.equal(e.zvE, Math.floor(45000 - 1659 - 4185 - 4448 - 36));
  assert.equal(e.est, Tax.grundtarif(2025, e.zvE));
  assert.equal(e.soli, 0);
  assert.equal(e.kist, 0);
  assert.equal(e.erstattung, 6500 - e.est);
});

test('Kinder: bei hohem Einkommen ist der Freibetrag günstiger, sonst das Kindergeld', () => {
  const basis = { jahr: 2025, veranlagung: 'joint', kinder: 2 };
  const hoch = Tax.berechne({ ...basis, p: [person({ brutto: 180000 }), person({})] });
  const niedrig = Tax.berechne({ ...basis, p: [person({ brutto: 50000 }), person({})] });
  assert.equal(hoch.freibetragGuenstiger, true);
  assert.equal(niedrig.freibetragGuenstiger, false);
  assert.equal(hoch.est, hoch.tarifSteuer + 2 * 3060);
});

test('§ 35a mindert die Steuer höchstens bis auf null', () => {
  const e = Tax.berechne({ jahr: 2025, veranlagung: 'single', handwerker: 10000, p: [person({ brutto: 14500 })] });
  assert.equal(e.erm35a, 1200);
  assert.equal(e.est, 0);
});

test('Kirchensteuer nur für Mitglieder', () => {
  const p = { brutto: 60000 };
  const mit = Tax.berechne({ jahr: 2025, veranlagung: 'single', kistSatz: 9, p: [person({ ...p, kirche: true })] });
  const ohne = Tax.berechne({ jahr: 2025, veranlagung: 'single', kistSatz: 9, p: [person(p)] });
  assert.equal(mit.kist, Math.round(mit.est * 9) / 100);
  assert.equal(ohne.kist, 0);
});

test('Leere Eingaben ergeben null', () => {
  const e = Tax.berechne({ jahr: 2025, veranlagung: 'single', p: [{}] });
  assert.equal(e.est, 0);
  assert.equal(e.erstattung, 0);
  assert.equal(e.hatEingaben, false);
});
