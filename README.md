# 🌍 Frontline Tactics 3D — WebGL Grandmaster Edition

Eine interaktive, moderne 3D-WebGL-Adaption des strategischen rundenbasierten Brettspiel-Genres, entwickelt mit **Three.js**, **TypeScript** und **Vite**.

![Frontline Tactics 3D Banner](https://img.shields.io/badge/WebGL-Three.js-blueviolet?style=for-the-badge&logo=three.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?style=for-the-badge&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?style=for-the-badge&logo=vite)
![License](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)

---

## 🌟 Features

### 🎮 Spielmodi & Regeln
- **🌍 Weltherrschaft (Klassisch):** Erobere alle 42 Gebiete auf allen 6 Kontinenten und schalte alle gegnerischen Kommandanten aus.
- **🕵️ Geheime Missionen:** Verdeckte Missionskarten (z. B. bestimmte Kontinente einnehmen, bestimmte Rivalen eliminieren oder 18/24 Gebiete beherrschen).
- **🏛️ Hauptstädte (Capital Tactics):** Jeder Spieler startet mit einer befestigten Hauptstadt (+4 Truppen & +2 Rundenbonus). Das Halten aller Hauptstädte führt zum Sofortsieg.
- **⚡ 70% Dominanz (Schnellspiel):** Schneller Spielmodus – wer zuerst 30 von 42 Gebieten (70 %) beherrscht, gewinnt.
- **⏳ Rundenlimit (Turn Limit):** Nach einer festen Rundenzahl gewinnt der Spieler mit dem höchsten Score (Gebiete, Kontrollboni, Truppenstärke).

### 🤖 Grandmaster KI Engine
- **Strategische Heuristik:** Taktische Analyse von Kontinent-Engpässen (Choke Points), Expansionschancen und Frontabsicherungen.
- **Wahrscheinlichkeitsberechnung:** Exakte stochastische Kampfberechnung (`combatMath.ts`) für Risiko-Nutzen-Abwägungen vor Angriffen.
- **Multi-Player Support:** Unterstützt 2 bis 6 Spieler (menschliche Spieler & anspruchsvolle KI-Gegner).

### 🎨 Visuelles & 3D WebGL Erlebnis
- **Interaktiver 3D-Globus/Tabletop:** 42 detaillierte extrudierte Territorien, Relief-Höhenanzeige je nach Truppenstärke und Kontinentalfarben.
- **OrbitControls:** Freie Drehung, Zoom und Neigung der Weltkarte per Maus/Touch.
- **Kinetische Kampfeffekte:** 3D-Artillerie-Projektile, Explosionen, animierte 3D-Würfel und Partikeleffekte bei Schlachten.
- **Flüssiges HUD & UI:** Glassmorphism-Design, projizierte 2D/3D-Labels, Live-Machtbalken, Echtzeit-Ranking und Rundenhistorie.
- **Tempo-Steuerung:** Einstellbare Animationsgeschwindigkeiten (1x, 2x, 4x) für flüssiges Durchspielen von KI-Zügen.

### 🔊 Prozedurales Sound-System
- **Web Audio API:** Keine externen Audio-Dateien notwendig. Prozedural erzeugte Soundeffekte für Klicks, Würfelwürfe, Kanonenschüsse, Truppenmärsche, Kartentausch und Siegesfanfaren.

---

## 🗺️ Kontinente & Bonustruppen

| Kontinent | Gebiete | Bonus-Verstärkung / Runde |
|---|:---:|:---:|
| 🟢 **Nordamerika** | 9 | +5 |
| 🟤 **Südamerika** | 4 | +2 |
| 🔵 **Europa** | 7 | +5 |
| 🟡 **Afrika** | 6 | +3 |
| 🔴 **Asien** | 12 | +7 |
| 🟣 **Australien** | 4 | +2 |

---

## 🛠️ Tech-Stack

- **3D Rendering & Kamera:** [Three.js](https://threejs.org/) (WebGL, BufferGeometry, ExtrudeGeometry, Raycaster, OrbitControls)
- **Programmiersprache:** [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
- **Build-Tool & Dev Server:** [Vite](https://vitejs.dev/)
- **Audio:** Web Audio API (Synthetisierte Soundeffekte & Fanfaren)
- **UI & Styling:** Modernes Vanilla CSS (Glassmorphism, CSS Custom Properties, Responsive Flex/Grid)

---

## 🚀 Schnellstart

### Voraussetzungen
- [Node.js](https://nodejs.org/) (Version 18+ empfohlen)
- npm oder yarn / pnpm

### Installation

1. **Repository klonen** (falls nicht bereits geschehen):
   ```bash
   git clone <repository-url>
   cd frontline-tactics-3d
   ```

2. **Abhängigkeiten installieren:**
   ```bash
   npm install
   ```

3. **Entwicklungsserver starten:**
   ```bash
   npm run dev
   ```
   Öffne anschließend die im Terminal angezeigte URL (in der Regel `http://localhost:5173`) im Browser.

---

## 📦 Skripte

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Startet den lokalen Vite-Entwicklungsserver mit Hot Module Replacement (HMR). |
| `npm run build` | Führt die TypeScript-Typüberprüfung (`tsc`) durch und baut das optimierte Production-Bundle in `/dist`. |
| `npm run preview` | Startet eine lokale Vorschau des gebauten Production-Bundles. |

---

## 📁 Projektstruktur

```text
frontline-tactics-3d/
├── index.html           # HTML-Grundgerüst & HUD-Overlay-Struktur
├── package.json         # Projektmetadaten, Abhängigkeiten & Skripte
├── tsconfig.json        # TypeScript-Konfiguration
├── dist/                # Kompiliertes Production-Bundle (nach npm run build)
└── src/
    ├── main.ts          # App-Initialisierung, UI-Controller, Event-Handler & Spielschleife
    ├── gameState.ts     # Datenmodelle, Spielphasen, Karten-Deck & Missionslogik
    ├── scene3d.ts       # Three.js 3D-Szene, Beleuchtung, Territorien, Truppen & Animationen
    ├── mapData.ts       # Polygone, Nachbarschaften & Metadaten aller 42 Gebiete
    ├── combatMath.ts    # Würfelmechanik, Verlustberechnung & Gewinnwahrscheinlichkeiten
    ├── ai.ts            # Heuristische Grandmaster-KI (Verstärkung, Angriffs- & Befestigungsstrategie)
    ├── sound.ts         # Prozeduraler Web-Audio Sound-Synthesizer
    └── style.css        # Modernes UI-Design, Glassmorphism-HUD & Panels
```

---

## 🎲 Spielablauf in Kürze

1. **Verstärkung (Reinforce):** Erhalte Truppen basierend auf kontrollierten Gebieten, Kontinent-Boni und eingetauschten Taktik-Karten. Platziere sie strategisch.
2. **Angriff (Attack):** Wähle ein eigenes Gebiet mit mindestens 2 Truppen und greife ein benachbartes feindliches Gebiet an. Die 3D-Würfel entscheiden über Sieg oder Verlust.
3. **Truppenbewegung (Fortify):** Bewege am Ende deines Zugs Truppen zwischen zusammenhängenden eigenen Gebieten zur Grenzsicherung.

---

## ⚖️ Rechtlicher Hinweis / Disclaimer

> **Hinweis:** Dieses Projekt ist ein unabhängiges Open-Source-Spiel, inspiriert von klassischen rundenbasierten Gebiets- und Brettspielen. Es steht in keiner geschäftlichen oder rechtlichen Verbindung zu Hasbro, Inc. oder der offiziellen Marke *RISK® / RISIKO®*. Alle Programm-Codes, 3D-Modelle und Sounds wurden eigenständig und prozedural entwickelt.

---

## 📜 Lizenz

Dieses Projekt ist unter der [MIT License](LICENSE) lizenziert.
