# Flugsimulator

Ein Cockpit-Flugsimulator für den Browser: Du sitzt als Pilot in einem zweistrahligen Jet,
startest in **Seeblick**, fliegst durch das Tal und landest in **Adlerhorst**.

Läuft komplett im Browser (Desktop mit Tastatur/Maus, Handy und Tablet per Touch) –
ohne Installation, ohne Server. Alle Geräusche werden live erzeugt, es gibt keine Sounddateien.

## Starten

`index.html` im Browser öffnen. Alternativ einen kleinen Webserver im Ordner starten:

```
python3 -m http.server 8000
```

und dann `http://localhost:8000` aufrufen.

## Schwierigkeitsstufen

| Stufe | Was passiert |
|---|---|
| **Leicht** | Normaler Flug bei bestem Wetter. Grüne Tore und Tipps zeigen den Weg, der Flugschutz verhindert Überziehen und zu steile Kurven. |
| **Mittel** | Wolken und Wind. Unterwegs tritt eine zufällige Störung auf (manchmal eine zweite). Checkliste abarbeiten und sicher landen. |
| **Schwer** | Gewitter mit Regen, Böen und Seitenwind. Kurz nach dem Start fällt ein Triebwerk aus oder brennt, danach folgen zwei bis drei weitere Ausfälle. Keine Tore, kaum Flugschutz. |

Mögliche Störungen: Triebwerksausfall, Triebwerksbrand, Vogelschlag, Hydraulikausfall,
Stromausfall, Fahrtmesser-Ausfall, Treibstoffleck, Fahrwerksstörung, blockierte Landeklappen.

Außerdem wählbar: **Ganzer Flug** (Start bis Landung, ca. 8 Minuten) oder **Nur Landeanflug** (ca. 4 Minuten).

## Steuerung

| Taste | Funktion |
|---|---|
| ↓ / ↑ | Steuerhorn ziehen (steigen) / drücken (sinken) |
| ← / → | nach links / rechts rollen |
| W / S | Schub erhöhen / verringern |
| A / D | Seitenruder (am Boden: lenken) |
| G | Fahrwerk |
| F / R | Landeklappen aus- / einfahren |
| Leertaste | Radbremsen |
| V | Ansicht Cockpit / außen |
| 1 / 2 | Feuerlöscher Triebwerk 1 / 2 |
| I | Triebwerk neu starten |
| X | Fahrwerk-Notausfahren |
| N | Notstrom |
| Enter | Warnton quittieren |
| P · M · H | Pause · Ton · Hilfe |

Touch: Im Fenster mit dem Finger ziehen = Steuerhorn. Schubhebel und alle Knöpfe liegen im Cockpit unten.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Seite, Cockpit-Layout, Menüs |
| `js/world.js` | Gelände, Flughäfen, Himmel, Wetter, Wegpunkt-Tore |
| `js/physics.js` | Flugphysik, Triebwerke, Fahrwerk, Systeme |
| `js/failures.js` | Störungen, Checklisten, Warnsysteme |
| `js/audio.js` | Geräusche und Alarme (Web Audio) |
| `js/panel.js` | Instrumente (Hauptfluganzeige, Navigation, Triebwerke) |
| `js/model.js` | Flugzeugmodell für die Außenansicht |
| `js/main.js` | Spielablauf, Eingabe, Kamera, Auswertung |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | Damit sich der Simulator am Handy wie eine App installieren lässt und offline startet |
| `vendor/three.min.js` | 3D-Bibliothek three.js (MIT-Lizenz, siehe `vendor/three.LICENSE.txt`) |
