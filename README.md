# Rezeptverwaltung mit Backend

Eine Webanwendung für den privaten Gebrauch zur Verwaltung von Rezepten und Einkaufslisten mit Node.js Backend und JSON-Dateien.

## Struktur

```
.
├── server.js              # Node.js HTTP-Server (native Module, keine npm-Dependencies)
├── package.json           # Projekt-Metadaten
├── public/
│   └── index.html        # Frontend (React + Tailwind CSS)
├── images/               # Rezeptbilder (optional)
│   ├── Rezept_001.png
│   ├── Rezept_002.jpg
│   └── ...
└── data/
    ├── rezepte.json      # Rezeptdatenbank
    ├── to_be_cooked.json # Geplante Rezepte
    └── to_be_bought.json # Zusammengefasste Einkaufsliste
```

## Installation

1. **Node.js installieren** (falls noch nicht vorhanden)
   - Download von https://nodejs.org/

2. **Keine weiteren Dependencies nötig!**
   - Der Server verwendet nur Node.js Standard-Module (`http`, `fs`, `path`, `url`)

## Server starten

```bash
npm start
```

oder direkt:

```bash
node server.js
```

Der Server läuft dann auf `http://localhost:3000`

## Features

### 📋 Rezepte-Tab

- **Rezepte hinzufügen**: Drei Suchmodi verfügbar
  - 🔍 Nach Name suchen
  - 🎲 Zufallsvorschlag
  - 🥕 Nach Zutat durchsuchen
- **Bilder**: Unterstützt sowohl Emojis (🍝) als auch Bilddateien (.png, .jpg, .gif, .webp)
- **Automatische Zutatenverwaltung**: Beim Hinzufügen eines Rezepts werden alle Zutaten automatisch zur Einkaufsliste hinzugefügt

### 🛒 Zutaten-Tab

- **Intelligente Zusammenfassung**: Gleiche Zutaten werden automatisch zusammengefasst
  - Beispiel: `200g Kartoffeln` + `300g Kartoffeln` → `200g + 300g Kartoffeln`
  - Mengen werden pro Rezept getrennt angezeigt
- **Rezept-Tags**: Jede Zutat zeigt an, in welchen Rezepten sie benötigt wird
- **Mehrfachauswahl**: Checkboxen für jede Zutat
  - "Alle auswählen" Funktion
  - Sammel-Löschen-Button für markierte Zutaten
- **Bearbeiten**: ✎-Button zum Ändern der Menge/des Namens
- **!-Button**: Zeigt alle zugehörigen Rezepte an und ermöglicht das gemeinsame Löschen

### 🔴 Rote Kacheln (Entfernte Zutaten)

Wenn ein Rezept gelöscht wird, erscheinen rote Hinweise für Zutaten, die:
- **Im gelöschten Rezept** enthalten waren UND
- **Nicht mehr** in der aktuellen Einkaufsliste stehen (weil sie schon besorgt wurden)

Diese Funktion hilft beim Einkaufen: Zutaten die bereits im Einkaufswagen liegen, aber nicht mehr benötigt werden, können zurückgelegt werden.


## API Endpoints

### Rezepte
- `GET /api/rezepte` - Alle verfügbaren Rezepte
- `GET /api/to-be-cooked` - Geplante Rezepte
- `POST /api/to-be-cooked` - Rezept hinzufügen
- `DELETE /api/to-be-cooked/:id` - Rezept löschen
  - Gibt `removedIngredients` zurück (Zutaten die entfernt wurden)

### Zutaten
- `GET /api/to-be-bought` - Einkaufsliste (zusammengefasst)
- `POST /api/to-be-bought` - Zutat manuell hinzufügen
- `PUT /api/to-be-bought/:index` - Zutat bearbeiten (Menge ändern)
- `DELETE /api/to-be-bought/:index` - Zutat löschen

### Statische Dateien
- `GET /` oder `/index.html` - Frontend
- `GET /images/:filename` - Rezeptbilder (PNG, JPG, GIF, WebP)

## Datenformat

### rezepte.json

```json
[
  {
    "id": 1,
    "name": "Spaghetti Carbonara",
    "bild": "🍝",
    "zutaten": ["400g Spaghetti", "4 Stk. Ei", "200g Speck", "100g Parmesan", "Pfeffer"]
  },
  {
    "id": 2,
    "name": "Käsekuchen",
    "bild": "Rezept_002.png",
    "zutaten": ["500g Quark", "3 Stk. Ei", "100g Zucker", "1 Pkt. Vanillezucker"]
  }
]
```

**Wichtig**: Das `bild`-Feld kann entweder:
- Ein **Emoji** sein (z.B. `"🍝"`)
- Ein **Dateiname** sein (z.B. `"Rezept_001.png"`)
  - Bilddateien müssen im `images/` Ordner liegen

### to_be_cooked.json

Speichert die aktuell geplanten Rezepte (gleiche Struktur wie `rezepte.json`).

### to_be_bought.json

```json
[
  {
    "name": "200g + 300g Kartoffeln",
    "baseName": "Kartoffeln",
    "amounts": ["200g", "300g"],
    "rezeptIds": [1, 2],
    "rezeptNames": ["Rezept A", "Rezept B"]
  },
  {
    "name": "Milch",
    "baseName": "Milch",
    "amounts": [],
    "rezeptIds": [],
    "rezeptNames": []
  }
]
```

- `name`: Anzeigename mit zusammengefassten Mengen
- `baseName`: Zutat ohne Mengenangabe (für Vergleiche)
- `amounts`: Array der einzelnen Mengen pro Rezept
- `rezeptIds`: IDs der Rezepte die diese Zutat benötigen
- `rezeptNames`: Namen der Rezepte (für Display)

**Leere Arrays** (`rezeptIds: []`) = Manuell hinzugefügte Zutat

## Intelligente Zutaten-Zusammenfassung

Das System erkennt gleiche Zutaten auch wenn sie unterschiedliche Mengen haben:

```
"200g Kartoffeln" + "300g Kartoffeln" → "200g + 300g Kartoffeln"
"2 EL Olivenöl" + "1 EL Olivenöl"     → "2 EL + 1 EL Olivenöl"
"Salz" + "Salz"                       → "Salz"
```

Unterstützte Mengeneinheiten:
- Gewicht: `g`, `kg`, `oz`, `lb`
- Volumen: `ml`, `l`, `EL`, `TL`, `cup`, `fl oz`
- Stückzahl: `Stk.`, `Pkt.`, `Prise`
- Brüche: `½`, `¼`, `¾`, `⅓`, `⅔`, `⅛`, `⅜`, `⅝`, `⅞`

## Bilder hinzufügen

1. Erstelle einen `images/` Ordner im Projektverzeichnis
2. Speichere Rezeptbilder dort (PNG, JPG, GIF oder WebP)
3. Referenziere sie in `rezepte.json`:

```json
{
  "id": 5,
  "name": "Lasagne",
  "bild": "Rezept_005.png",
  "zutaten": [...]
}
```

Der Server serviert die Bilder automatisch unter `/images/Rezept_005.png`

## Tipps

- **Rezepte mit IDs versehen**: Stelle sicher dass jedes Rezept eine eindeutige `id` hat
- **Mengen immer am Anfang**: `"200g Kartoffeln"` funktioniert, `"Kartoffeln 200g"` nicht
- **Backup**: Sichere deine `data/rezepte.json` regelmäßig
- **Bilder optimieren**: Halte Bilder klein (max. 500KB) für schnelles Laden

## Fehlerbehebung

**Server startet nicht:**
```bash
# Prüfe ob Port 3000 bereits belegt ist
lsof -i :3000
# Stoppe andere Prozesse oder ändere den Port in server.js
```

**Bilder werden nicht angezeigt:**
- Prüfe ob der `images/` Ordner existiert
- Prüfe ob der Dateiname in `rezepte.json` exakt mit der Datei übereinstimmt (inkl. Groß-/Kleinschreibung)
- Öffne direkt `http://localhost:3000/images/Rezept_001.png` im Browser

**Zutaten werden nicht zusammengefasst:**
- Stelle sicher dass die Mengenangabe am Anfang steht
- Verwende konsistente Schreibweisen (z.B. immer `g` statt manchmal `Gramm`)
- 
