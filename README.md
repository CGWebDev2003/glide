# Glide

Nimmt Websites als **perfekt flüssiges Scroll-Video** auf, inklusive CSS-Animationen,
IntersectionObserver-Reveals, GSAP/ScrollTrigger und Lenis. Gedacht für Showcase-Videos
von Kundenwebsites (Portfolio, Instagram, Akquise).

Statt den Bildschirm in Echtzeit aufzunehmen, rendert Glide **deterministisch Frame für Frame**:
Die Zeit im Browser ist virtuell. Pro Frame wird sie um exakt `1/fps` vorgestellt, die
Scrollposition gesetzt und ein Screenshot gemacht. ffmpeg baut daraus das Video. Wie lange die
Aufnahme dauert, spielt keine Rolle: Jeder Frame zeigt exakt den Zustand zu seinem Zeitpunkt.

Glide gibt es als **Web-App (PWA)** und als **CLI**. Beide nutzen denselben Kern und dieselben Config-Dateien.

---

## Installation

Voraussetzungen: **Node.js ≥ 20.9** und **ffmpeg** (mit libx264, für WebM zusätzlich libvpx-vp9).

```bash
# ffmpeg
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu/Debian
winget install Gyan.FFmpeg     # Windows

# Glide
git clone <repo> glide && cd glide
npm install                    # installiert alles und baut Kern + CLI
npx playwright install chromium
```

Wenn ffmpeg nicht im PATH liegt: `GLIDE_FFMPEG=/pfad/zu/ffmpeg`.
Fehlen ffmpeg oder der Encoder, bricht Glide vor dem Laden der Seite mit einer
Installationsanleitung ab. In der Web-App steht der Hinweis direkt oben.

## Web-App

```bash
npm run app        # baut und startet Glide auf http://localhost:4321
npm run dev        # Entwicklungsmodus mit Hot Reload (ohne Service Worker)
```

Die App läuft lokal auf deinem Rechner, gerendert wird dort ebenfalls. Es gibt keine Server- oder Cloudkosten.

- **Aufnehmen**: URL eingeben, Gerät, Scroll-Modus, Tempo, Intro/Outro, Hover & Klicks und auszublendende Elemente wählen. Für gängige Cookie-Banner und Chat-Widgets gibt es Ein-Klick-Chips. Seltene Optionen stehen unter „Erweitert“.
- **In der Vorschau auswählen**: öffnet die Seite live im Aufnahme-Viewport. Statt Selektoren einzutippen, zeigst du auf ein Element und klickst es an: als **Hover**, als **Klick** oder zum **Ausblenden** (Cookie-Banner, Chat-Widgets). Mehr unter [Elemente in der Vorschau auswählen](#elemente-in-der-vorschau-auswählen).
- **Live-Fortschritt**: „Frame x von y“, Render-Geschwindigkeit, Restzeit und alle ~0,5 s ein Vorschaubild des aktuellen Frames. Aufnahmen landen in einer Warteschlange und laufen nacheinander. Eine laufende Aufnahme lässt sich abbrechen.
- **Videos**: Galerie mit Poster-Bild, Player, Download, „Erneut“ (lädt die Einstellungen zurück ins Formular) und Löschen. Auf dem Handy kann der Player das Video direkt teilen.
- **Projekte**: Einstellungen pro Kunde speichern und wieder laden.
- **Config als JSON**: zeigt die Einstellungen als CLI-kompatibles JSON. Du kannst es bearbeiten, kopieren oder eine vorhandene `kunde.json` laden.
- **Benachrichtigung**, wenn ein Video fertig ist (nach einmaliger Freigabe über 🔔).

Alles wird in **`~/Glide`** gespeichert: `videos/` (MP4/WebM + Poster), `projects.json` und `jobs.json` (Verlauf). Mit `GLIDE_DATA_DIR=/anderer/ordner npm run app` lässt sich der Ort ändern.

### Als App installieren (PWA)

Öffne `http://localhost:4321` in Chrome, Edge oder Safari (macOS Sonoma+) und wähle **„Installieren“** bzw. **„Zum Dock hinzufügen“**. Glide läuft dann in einem eigenen Fenster mit eigenem Icon. Der Service Worker cached nur die App-Oberfläche; Aufnahmen und Videos kommen immer live vom lokalen Server. Ist Glide nicht gestartet, zeigt die App einen Hinweis statt einer Fehlerseite.

**Share Target**: Bei installierter App erscheint Glide im „Teilen“-Menü (Android/ChromeOS, Desktop-Chrome). Teilst du einen Link, öffnet sich Glide mit vorausgefüllter URL. Manuell geht das auch per `http://localhost:4321/?url=https://kunde.de`.

**Vom Handy aus**: Starte Glide mit `npm run app` und öffne `http://<IP-deines-Rechners>:4321` im selben WLAN. Bedienung und Downloads funktionieren. Installieren als PWA, Share Target und Benachrichtigungen verlangen aber HTTPS, über eine reine LAN-IP gehen sie also nicht. Dafür einen HTTPS-Tunnel verwenden, z. B. `tailscale serve 4321`. Achtung: Wer die Adresse kennt, kann Aufnahmen starten. Den Port daher nicht ungeschützt ins Internet stellen.

## Desktop-App

Dieselbe Web-App als eigenständiges Programm mit Icon im Dock/Startmenü. Beim Öffnen startet
Glide seinen Server selbst im Hintergrund, beim Beenden stoppt er wieder. Ein Terminal oder
`npm run app` ist nicht nötig.

```bash
npm run desktop:dist    # baut die App für dein Betriebssystem
```

Danach liegt in `apps/desktop/dist/` der Installer:

- **macOS**: `Glide-….dmg` öffnen und Glide in „Programme“ ziehen
- **Windows**: `Glide Setup ….exe` ausführen
- **Linux**: `Glide-….AppImage` ausführbar machen und starten

Gebaut wird immer für das System, auf dem du den Befehl ausführst (die Mac-App also auf dem Mac).
Nach Änderungen am Code einfach erneut `npm run desktop:dist` ausführen und die App ersetzen.
Zum Ausprobieren ohne Installer: `npm run desktop`.

Hinweise:

- **ffmpeg** und **Chromium** sind in der App enthalten. Die fertige App läuft also auch auf Rechnern ohne Node.js, ffmpeg oder Playwright und lässt sich einfach weitergeben. Beim Bauen lädt `npm install` ffmpeg (über `ffmpeg-static`) und `npm run desktop` Chromium für das eigene System herunter. Der Installer wird dadurch deutlich größer.
- Sind `GLIDE_FFMPEG` oder `PLAYWRIGHT_BROWSERS_PATH` systemweit gesetzt, nutzt die App diese statt der mitgelieferten Versionen. Dasselbe gilt für `GLIDE_DATA_DIR`.
- Das mitgelieferte ffmpeg steht unter der GPL. Lizenz und Build-Infos liegen in der App unter `resources/ffmpeg/`.
- Unter Windows ist die App nicht signiert. Beim ersten Start warnt SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“.
- Videos, Projekte und Verlauf liegen weiterhin in **`~/Glide`**, Web-App und Desktop-App teilen sie sich.
- Läuft bereits `npm run app` auf Port 4321, öffnet die Desktop-App einfach diese Instanz. Ist der Port anderweitig belegt, nimmt sie einen freien.
- Laufen beim Beenden noch Aufnahmen, fragt Glide vorher nach.
- Die Mac-App ist nur ad-hoc signiert (ohne Apple-Entwicklerzertifikat). Selbst gebaut startet sie normal. Kopierst du sie auf einen anderen Mac, beim ersten Start Rechtsklick → „Öffnen“.

## CLI

```bash
npm link -w glide              # stellt `glide` global bereit (einmalig)

# Schnelltest ohne Config
glide record --url https://kunde.de --preset mobile
glide record --url https://kunde.de --mode sections --pause 1.5 --hide "#cookie-banner"
glide record --url https://kunde.de --hover ".pricing-card.featured" --click ".faq-item button"

# reproduzierbar mit Config (Pfade relativ zur Config-Datei)
glide init kunde.json --url https://kunde.de
glide record kunde.json
glide record kunde.json --preset laptop -o kunde-laptop.mp4   # Flags überschreiben die Config
```

Während der Aufnahme zeigt das Terminal `Frame x/y`, Render-Geschwindigkeit und ETA.
Mit `--debug-frames <dir>` wird zusätzlich jeder 30. Frame als Bild gespeichert,
`--headful` zeigt das Browserfenster.

### Alle CLI-Flags

| Flag | Bedeutung |
|---|---|
| `-u, --url` | URL (überschreibt Config) |
| `-o, --out` | Ausgabedatei (`.webm` schaltet auf WebM) |
| `-p, --preset` | `desktop` (1920×1080), `laptop` (1440×900), `mobile` (390×844) |
| `--viewport 1280x800` | eigener Viewport |
| `--dsf`, `--fps`, `--format` | deviceScaleFactor, Framerate, `mp4`/`webm` |
| `--mode`, `--speed`, `--duration`, `--easing`, `--pause` | Scroll-Steuerung |
| `--intro`, `--outro` | Standzeit oben/unten in Sekunden |
| `--driver` | `auto`, `native`, `lenis`, `custom` |
| `--hide <sel...>` | Elemente ausblenden |
| `--hover <sel...>`, `--click <sel...>` | Elemente hovern bzw. anklicken (siehe [Hover & Klicks](#hover--klicks)) |
| `--cursor` | `auto`, `arrow`, `touch`, `none` |
| `--no-prepass` | Lazy-Loading-Vorlauf überspringen |
| `--max-duration` | Sicherheitsgrenze in Sekunden |
| `--browser` | `chromium` (Standard), `chrome`, `msedge` |
| `--headful`, `--debug-frames <dir>`, `-q` | Debugging, ruhige Ausgabe |

## Config

Eine JSON-Datei pro Projekt. Nur `url` ist Pflicht, alles andere hat Defaults.

```json
{
  "url": "https://www.kunde.de",
  "output": "kunde-desktop.mp4",
  "viewport": "desktop",
  "deviceScaleFactor": 2,
  "fps": 60,
  "format": "mp4",
  "scroll": {
    "mode": "sections",
    "speed": 900,
    "easing": "easeInOutCubic",
    "pauseDuration": 1.2,
    "sections": ["header", "main > section", "footer"]
  },
  "introDuration": 2.5,
  "outroDuration": 1.5,
  "scrollDriver": "auto",
  "hideSelectors": ["#CybotCookiebotDialog", ".intercom-lightweight-app"],
  "maxDuration": 90
}
```

Weitere Beispiele: [`apps/cli/examples/kunde-desktop.json`](apps/cli/examples/kunde-desktop.json),
[`apps/cli/examples/kunde-instagram.json`](apps/cli/examples/kunde-instagram.json) (9:16, 1080×1920).
In der Web-App lassen sich dieselben Dateien unter „Config als JSON → Datei laden“ öffnen.

| Feld | Default | Beschreibung |
|---|---|---|
| `url` | – | Seite |
| `output` | `<host>-<preset>.mp4` | Ausgabedatei, relativ zur Config |
| `viewport` | `"desktop"` | `"desktop"`, `"laptop"`, `"mobile"` oder `{ "width", "height" }` |
| `deviceScaleFactor` | `2` | Render-Auflösung. Das Video wird mit Lanczos auf `outputSize` skaliert, das gibt scharfe Texte |
| `outputSize` | Viewport-Größe; bei Viewports < 800 px Breite Viewport × dsf | Videoauflösung `{ "width", "height" }` (wird auf gerade Zahlen gerundet) |
| `fps` | `60` | Framerate |
| `format` | `"mp4"` | `mp4` = H.264 High, yuv420p, `+faststart` (Instagram/Browser-kompatibel); `webm` = VP9 |
| `crf` / `encoderPreset` | `16` / `"slow"` | x264-Qualität (14–18 ≈ visuell verlustfrei) |
| `captureFormat` / `captureQuality` | `"jpeg"` / `95` | Screenshot-Format. JPEG ist bei 4K-Captures deutlich schneller, `png` ist verlustfrei |
| `scroll.mode` | `"continuous"` | `continuous`: einmal durch; `sections`: Etappen mit Pausen |
| `scroll.speed` | `600` | px/s (Durchschnitt; mit Easing ist es in der Mitte schneller) |
| `scroll.duration` | – | Gesamtdauer des Scrollens in s, überschreibt `speed` |
| `scroll.easing` | `"easeInOutCubic"` | `linear`, `easeInOutSine`, `easeInOutQuad`, `easeInOutCubic`, `easeInOutQuart`, `easeInOutQuint`, `easeInOutExpo`, `easeOutCubic`, `easeInCubic` |
| `scroll.pauseDuration` | `1.2` | Pause je Section (s) |
| `scroll.sections` | auto | Selektor(en) für die Stopps. Auto: `header`, `section`, `footer`, `[data-glide-section]`; nur äußerste Elemente ab 25 % Viewporthöhe. Stopps, die näher als 30 % Viewporthöhe beieinanderliegen, werden zusammengelegt |
| `scroll.sectionOffset` | `0` | px oberhalb der Section anhalten (z. B. für einen Fixed Header) |
| `scroll.minSegmentDuration` | `0.8` | Mindestdauer pro Etappe (s) |
| `introDuration` | `2` | Standzeit oben (Hero-Animation) |
| `outroDuration` | `1.5` | Standzeit unten |
| `warmup` | `0` | Virtuelle Sekunden, die vor dem ersten Frame vorgespult werden (z. B. Preloader überspringen) |
| `scrollDriver` | `"auto"` | `auto`: Lenis, wenn gefunden, sonst nativ; `native`, `lenis`, `custom` |
| `lenisPath` | `"lenis"` | Pfad auf `window` zur Lenis-Instanz, z. B. `"app.lenis"` |
| `scrollHook` | – | für `custom`: JS-Funktion als String, `"(y) => { … }"`, darf async sein |
| `scrollContainer` | `"auto"` | Element, das statt des Dokuments scrollt. `auto`: wird erkannt, wenn das Dokument selbst nicht scrollen kann (z. B. `html, body { height: 100%; overflow-x: hidden }`); `none`: immer das Dokument; sonst ein CSS-Selektor |
| `actions` | `[]` | Hover & Klicks, siehe unten |
| `cursor.style` / `cursor.size` | `"auto"` / `28` | sichtbarer Cursor bei Aktionen: `auto` (Pfeil, auf Mobil-Viewports ein Touch-Punkt), `arrow`, `touch`, `none`; Größe in CSS-px |
| `hideSelectors` | `[]` | werden per injiziertem CSS mit `display:none !important` ausgeblendet, auch wenn sie später erscheinen |
| `injectCss` / `injectScript` | – | eigenes CSS bzw. JS (Funktionskörper, async erlaubt), läuft nach dem Laden |
| `hideScrollbar` | `true` | Scrollbar ausblenden |
| `prepass` | `true` | einmal komplett durchscrollen (Lazy Loading füllt den HTTP-Cache), dann neu laden |
| `eagerImages` | `true` | `loading="lazy"` → `eager` nach dem Laden |
| `syncVideos` | `true` | `<video>` pausieren und auf die virtuelle Zeit seeken |
| `imageTimeout` | `5000` | max. Wartezeit pro Frame auf Bilder im Sichtbereich (ms) |
| `maxDuration` | `120` | Sicherheitsgrenze (s). Wird sie überschritten, scrollt Glide schneller (mit Warnung), Intro und Outro bleiben gleich |
| `randomSeed` | `1337` | deterministisches `Math.random` (`null` = nativ) |
| `browser` | `"chromium"` | `chrome`/`msedge` nutzen ein installiertes Chrome/Edge. Nötig, wenn die Seite H.264/AAC-Videos abspielt, denn das Playwright-Chromium hat keine proprietären Codecs |
| `colorScheme`, `userAgent`, `headers`, `timeout`, `headful` | | Browser-Optionen |

## Hover & Klicks

Mit `actions` hovert oder klickt Glide Elemente im Video, z. B. eine Pricing-Karte, ein FAQ-Akkordeon oder ein Menü:

```json
"actions": [
  { "type": "hover", "selector": ".pricing-card:nth-child(2)", "duration": 1.5 },
  { "type": "click", "selector": ".faq button", "text": "Wie lange dauert", "duration": 2 }
]
```

| Feld | Default | Beschreibung |
|---|---|---|
| `type` | – | `hover` oder `click` |
| `selector` | – | CSS-Selektor. Es zählt der erste sichtbare Treffer |
| `text` | – | nur Treffer, deren Text das enthält (Groß/Klein egal). So wählst du unter mehreren gleichen Buttons einen aus |
| `duration` | `1.5` | Sekunden auf dem Element nach dem Ankommen (bei `click`: inklusive Klick) |
| `moveDuration` | `0.7` | Sekunden, die der Cursor zum Element braucht |

So läuft es ab:

- Die Aktionen laufen **von oben nach unten**, unabhängig von der Reihenfolge in der Config. Das Scrollen hält an jedem Element an, das Element steht dann in der Bildmitte. Elemente, die schon gemeinsam im Bild sind, teilen sich einen Stopp, der Cursor fährt dann direkt weiter. Im `sections`-Modus ersetzt ein Aktions-Stopp eine Section in der Nähe.
- Hover und Klick laufen als **echte Mausereignisse** durch Chromium: `:hover`, `mouseenter` und Klick-Handler greifen wie im echten Browser, und die ausgelösten Transitions laufen auf der virtuellen Zeit, sind also Frame für Frame flüssig.
- Ein **Cursor** wird ins Bild gezeichnet (Headless-Browser haben keinen). Er blendet neben dem Element ein, gleitet hin, „drückt“ beim Klick und blendet aus, sobald wieder gescrollt wird. Dabei verlässt auch die Maus die Seite, damit beim Weiterscrollen nichts anderes gehovert wird.
- **Links und Formulare öffnen keine neue Seite**: Ihre JS-Handler laufen, die Navigation des Browsers wird aber verhindert (auch Sprünge zu `#anker`, die dem Scroll-Zeitplan in die Quere kämen). Lädt die Seite trotzdem neu (z. B. per `location.href` im Skript), bricht Glide mit einer Meldung ab.
- Elemente, die nicht gefunden werden, werden mit einer Warnung übersprungen.
- `maxDuration` verkürzt nur das Scrollen, Aktionen behalten ihre Dauer.

### Elemente in der Vorschau auswählen

In der Web-App (und Desktop-App) unter „Hover & Klicks“ oder „Ausblenden“ auf **„In der Vorschau auswählen“** klicken. Glide öffnet die Seite in einem Browser im Hintergrund, mit demselben Viewport, User-Agent und denselben ausgeblendeten Elementen wie die Aufnahme, und zeigt sie live an.

- **Modus wählen**: *Hover*, *Klick* oder *Ausblenden*.
- **Zeigen**: Das Element unter der Maus wird markiert und benannt. Die Vorschau zeigt dabei auch den echten Hover-Zustand der Seite. Auf dem Handy: wischen zum Scrollen, tippen zum Auswählen.
- **Klicken** fügt das Element hinzu. Im Modus *Ausblenden* verschwindet es sofort aus der Vorschau.
- **Größer / Kleiner** tauscht die letzte Auswahl gegen das Eltern- bzw. Kind-Element, **Rückgängig** entfernt sie.
- Gewählte Hover & Klicks erscheinen nummeriert in der Vorschau. Rechts stehen alle Einträge, dort lassen sie sich auch wieder entfernen.

Glide wählt dabei sinnvolle Ziele: Bei Hover/Klick das klickbare Element (Button, Link …) statt des Icons darin, beim Ausblenden die äußerste fixierte Ebene (das ganze Banner statt nur seines „OK“-Buttons). Der erzeugte Selektor ist eindeutig und möglichst robust: Er nutzt IDs, `data-testid` & Co. oder `aria-label`, sonst Tag plus sprechende Klassen (keine Hash-Klassen wie `css-1x2y3`, keine Zustandsklassen wie `active`), notfalls mit `:nth-of-type`. Er landet wie getippte Selektoren in der Config.

In der Vorschau führen Klicks nie zu einer anderen Seite. Nach 3 Minuten ohne Aktivität schließt Glide den Vorschau-Browser. Es läuft immer nur eine Vorschau gleichzeitig.

## Ablauf einer Aufnahme

1. Chromium (headless) starten. Vor jedem Seitenskript wird die Runtime injiziert (virtuelle Uhr), und die Animations-Timeline wird per CDP eingefroren.
2. Seite laden, auf `load`, `networkidle`, `document.fonts.ready` und Bilder warten.
3. **Pre-Pass** (optional): einmal in Etappen durchscrollen, damit Lazy-Loading-Bilder im Cache landen, danach neu laden. Intro- und Once-Animationen starten dadurch frisch.
4. Elemente ausblenden, CSS/JS injizieren, Scroll-Treiber wählen.
5. **Intro**: oben stehen bleiben (`introDuration`).
6. Erst jetzt werden Seitenhöhe, Section-Positionen und Aktions-Elemente gemessen (GSAP-Pins und nachgeladene Inhalte haben sich dann gesetzt), und der Scroll-Zeitplan wird gebaut.
7. **Scrollen** (`continuous` oder `sections`) mit Stopps für Hover & Klicks, danach **Outro**.
8. Jeder Frame: `__glide.frame(y, 1000/fps)` → `Page.captureScreenshot` (CDP) → per Pipe direkt in ffmpegs stdin (keine Einzelbilder auf der Platte).

## Architektur

npm-Workspaces-Monorepo:

```
packages/core/            @glide/core: der Recorder (von CLI und Web-App genutzt)
  src/config.ts           Schema (zod), Presets, Output-Größe
  src/options.ts          browser-taugliche Konstanten für UIs (@glide/core/options)
  src/timeline.ts         reiner Scroll-Zeitplan: hold/move/action-Segmente, Easing, Sections, maxDuration
  src/actions.ts          Hover & Klicks: Elemente finden, Stopps wählen, Maus und Cursor pro Frame
  src/picker.ts           Vorschau zum Auswählen (PickerSession): Screenshots, Element unter dem Zeiger
  src/page/picker-runtime.ts  In-Page-Helfer der Vorschau: Zielwahl und Selektor-Erzeugung
  src/recorder.ts         Playwright-Ablauf, CDP, Treiberwahl, Frame-Loop, Abbruch, Live-Vorschau
  src/ffmpeg.ts           Prüfung, Encoder-Argumente, Streaming über stdin, Poster-Frames
  src/page/runtime.ts     In-Page-Runtime (virtuelle Zeit, Animationen, Videos, Scroll-Treiber)
  test/                   Testseite, E2E-Prüfung, Unit-Tests
apps/cli/                 `glide` CLI (commander), Fortschrittsanzeige, Ctrl+C bricht sauber ab
apps/web/                 Next.js-App (App Router) + PWA
  lib/server/jobs.ts      Warteschlange (eine Aufnahme gleichzeitig), Fortschritt, Verlauf in jobs.json
  app/api/events          Server-Sent Events: Job-Status live an alle offenen Fenster
  app/api/jobs, videos    Aufnahmen starten/abbrechen, Videos mit Range-Requests streamen, Poster
  app/api/projects        gespeicherte Projekte (projects.json)
  app/api/picker          Vorschau zum Auswählen: Sitzung öffnen, Screenshots, Zeigen/Scrollen/Ausblenden
  components/             Formular, laufende Aufnahmen, Galerie, Player
  public/sw.js            Service Worker (App-Shell offline, /api nie gecacht)
apps/desktop/             Electron-Hülle um die Web-App
  main.cjs                startet den gebündelten Server (Electron-eigenes Node.js) und öffnet das Fenster
  scripts/prepare-server.mjs  baut die Web-App als Next.js-Standalone-Server nach bundle/server
```

Die Web-App lädt `@glide/core` zur Laufzeit mit Nodes eigenem Modul-Loader statt über den Bundler (`lib/server/core.ts`). Playwright und die Runtime, die per `Function.prototype.toString` in die Seite injiziert wird, bleiben dadurch unverändert.

### Was ein Frame genau macht (`page/runtime.ts`)

1. Scrollposition setzen (nativ: `scrollTo({behavior:'instant'})`; Lenis: `lenis.scrollTo(y, {immediate:true, force:true})`; custom: Hook)
2. Zwei echte Browser-Frames abwarten: Der Browser feuert `scroll`-Events, berechnet IntersectionObserver und ruft deren Callbacks auf (z. B. `.in`-Klassen für Reveals)
3. Virtuelle Timer bis `t + 1/fps` in zeitlicher Reihenfolge ausführen
4. Virtuelle `requestAnimationFrame`-Callbacks ausführen (GSAP-Ticker → ScrollTrigger, Lenis `raf`)
5. Alle Web Animations (CSS-Animationen, -Transitions, `element.animate`) auf die virtuelle Zeit setzen
6. `<video>` seeken, auf Bilder im Sichtbereich und Fonts warten
7. Node macht den Screenshot

### Übernommene Muster aus timesnap/timecut/timeweb

[timesnap](https://github.com/tungs/timesnap) und [timeweb](https://github.com/tungs/timeweb) überschreiben vor dem Laden der Seite `Date`, `Date.now`, `performance.now`, `requestAnimationFrame` und `setTimeout`/`setInterval` und führen fällige Timer beim Vorspulen in zeitlicher Reihenfolge aus. Glide macht es genauso und ergänzt `requestIdleCallback` sowie ein deterministisches `Math.random`. Ebenfalls von dort übernommen: Frames per stdout/Pipe an ffmpeg streamen. timesnap selbst nennt CSS-Animationen und -Transitions als Grenze. timeweb ergänzt dafür `document.getAnimations()` mit Pausieren und Seeken sowie das Pausieren und Seeken von Videos; diesen Ansatz nutzt Glide hier auch.

### Entscheidung: Web Animations API + CDP-Freeze (Hybrid)

- **Nur CDP Animation Domain** (`Animation.animationStarted` + `seekAnimations`): Neue Animationen kommen als asynchrone Events mit IDs an, also mit einem Wettlauf zwischen Event und Screenshot. `seekAnimations` greift nur bei pausierten Animationen, `animationend`/`transitionend` feuern nicht, und WAAPI-Animationen von Bibliotheken (z. B. Motion) lassen sich schlechter abdecken. Für das Seeken ist das zu unzuverlässig.
- **Nur Web Animations API** (`document.getAnimations()` → pausieren → `currentTime` setzen): synchron im selben Tick, deckt CSS-Animationen, Transitions und `element.animate` ab, und Animationen ohne Dokument-Timeline (CSS Scroll-driven Animations) bleiben unberührt. **Aber:** Zwischen Seitenstart und erstem Frame laufen Animationen in Echtzeit. Bei langsam ladenden Seiten ist eine Hero-Animation ohne `fill-mode` dann schon vorbei und taucht in `getAnimations()` gar nicht mehr auf.
- **Gewählt: Hybrid.** Per CDP wird nur `Animation.setPlaybackRate(0)` gesetzt. Damit steht die Dokument-Timeline still, und keine Animation kann in Echtzeit fortschreiten, auch nicht während des Ladens. Geseekt wird ausschließlich synchron über die Web Animations API. Ist eine Animation zeitlich fertig, ruft Glide `finish()` auf, damit `animationend`/`transitionend` feuern.
  Belegt durch den E2E-Test: Mit `GLIDE_NO_CDP_FREEZE=1` (nur WAAPI) fehlt die `fill-mode:none`-Animation hinter einem 2,5 s langsamen Bild komplett im Video, mit Freeze ist sie in 39 Zwischenframes zu sehen. Ohne CDP (z. B. in anderen Browsern) fällt Glide auf reines WAAPI zurück und gibt eine Warnung aus.

### Größte Risiken (und was dagegen getan ist)

| Risiko | Gegenmaßnahme |
|---|---|
| Animationen laufen beim Laden in Echtzeit ab | CDP-Timeline-Freeze von Anfang an, virtuelle Uhr steht bis zum ersten Frame |
| IO-Reveals feuern zu spät oder gar nicht | pro Frame zwei echte Browser-Frames für Scroll-Events und IO-Callbacks; neue Transitions werden noch im selben Tick erfasst |
| Lenis arbeitet gegen den Treiber | `lenis.scrollTo(y, {immediate, force})` setzt Ziel und Ist-Wert gleich, es gibt keine Interpolation; Lenis' `raf` läuft auf der virtuellen Uhr |
| `scroll-behavior: smooth` | `behavior:'instant'` plus injiziertes `scroll-behavior:auto` |
| Lazy Images ploppen auf | Pre-Pass mit Reload, `loading=eager`, pro Frame auf Bilder im Sichtbereich warten |
| Seitenhöhe ändert sich (Pins, Nachladen) | Messung erst nach dem Intro |
| Langsame Aufnahme (4K-Screenshots) | CDP-JPEG mit `optimizeForSpeed`, Streaming mit Backpressure (~12 Frames/s bei 1920×1080 @2x in der Testumgebung) |
| Endlos lange Videos | `maxDuration` komprimiert den Scrollteil |

## Verifikation

```bash
npm test          # Unit-Tests
npm run test:e2e  # Testseite aufnehmen und Frames prüfen
npm run test:site -w @glide/core  # Testseite unter http://127.0.0.1:4173 (?lenis=0 ohne Lenis)
```

`test:e2e` nimmt die Testseite mit nativem und mit Lenis-Treiber auf, liest pro Frame den
Zustand aus der Seite und prüft:

- die virtuelle Zeit steigt pro Frame um exakt 1000/fps
- die Scrollposition folgt dem Zeitplan (≤ 0,5 px Abweichung), ist monoton und ohne Sprünge
- CSS-Keyframes, die `fill-mode:none`-Animation nach langsamem Laden, IO-getriggerte CSS-Transitions und GSAP-Tweens sind in **Zwischenzuständen** sichtbar (≥ 10 Frames zwischen 2 % und 98 %)
- eine Endlos-CSS-Animation dreht sich gleichmäßig (exakt 3°/Frame)
- ScrollTrigger `scrub:true` entspricht exakt der Scrollposition; `scrub:1` und der gepinnte horizontale Track bewegen sich kontinuierlich
- `<video>` wird pro Frame um exakt 1/fps weitergeseekt
- `hideSelectors` greift
- Vorschau-Auswahl: Ausblenden wählt die äußerste fixierte Ebene, Klick den Button, IDs werden genutzt, erzeugte Selektoren finden dasselbe Element wieder, ausgeblendete Elemente verschwinden
- Hover & Klicks (eigene Testseite `actions.html`): `:hover`-Transitions und Klick-Handler sind in Zwischenzuständen zu sehen, der Hover wandert von einem Element zum nächsten, das Scrollen steht während der Aktionen, ein Link-Klick navigiert nicht, der Cursor blendet ein und aus, fehlende Elemente werden übersprungen
- **Determinismus**: zwei Aufnahmen sind Frame für Frame bitidentisch (`ffmpeg -f framemd5`; als Toleranz für Decoder-Rundung bei Videos auf der Seite ist > 40 dB PSNR erlaubt)

Zusätzlich schreibt der Test Kontaktbögen (`packages/core/test/out/sheet-*.png`) zum Anschauen.

## Bekannte Grenzen

- **Videos auf der Seite**: werden pausiert und pro Frame auf die virtuelle Zeit geseekt. Das klappt bei normalen MP4/WebM-Dateien, sofern der Server HTTP-Range-Requests unterstützt (Standard bei Webservern und CDNs); ohne Range-Support kann der Browser nicht seeken. Das gebündelte Playwright-Chromium spielt **kein H.264/AAC** ab, dafür `"browser": "chrome"` setzen. Decodierte Videoframes können zwischen zwei Läufen um wenige LSB abweichen (nicht sichtbar). HLS/DASH-Streams (MSE) seeken oft ungenau oder langsam. Ton wird nie aufgenommen.
- **WebGL / Canvas / Three.js**: Alles, was über `requestAnimationFrame` und `performance.now` läuft, folgt der virtuellen Zeit. Headless-Chromium rendert WebGL aber per Software (SwiftShader). Das ist langsam, und manche Shader sehen anders aus. Bei Bedarf `headful: true` auf einem Rechner mit GPU verwenden.
- **Web Worker, OffscreenCanvas in Workern, Audio-Worklets** sehen die echte Zeit.
- **iframes** (z. B. eingebettete YouTube-/Maps-Embeds) haben eigene Uhren, die nicht vorgestellt werden.
- `event.timeStamp` und `document.timeline.currentTime` liefern die echte bzw. eingefrorene Zeit.
- Bibliotheken, die Geschwindigkeit aus echten Scroll-Event-Zeitstempeln berechnen (Velocity-Skew-Effekte), können anders aussehen als im echten Browser.
- CSS `animation-play-state`, das sich *nach* dem Start einer Animation per Klasse ändert, wird nicht respektiert (die Animation wird per API gesteuert). JS-seitiges `animation.pause()/play()` wird dagegen respektiert.
- Seiten, die in einem eigenen Container statt im Dokument scrollen (häufig `<body>` durch `html, body { height: 100%; overflow-x: hidden }`), erkennt Glide automatisch; im Log steht dann `Scroll driver: native (container: body)`. Greift die Erkennung nicht, den Container per `scrollContainer: ".scroller"` angeben.
- Lenis wird nur gefunden, wenn die Instanz auf `window` erreichbar ist (`window.lenis = lenis` oder `lenisPath`). Sonst warnt Glide und scrollt nativ, was mit Lenis meist trotzdem funktioniert.
- Preloader, die auf Timer warten, laufen in virtueller Zeit, also sichtbar im Intro. Mit `warmup` überspringen.
- Bot-Schutz (Cloudflare o. Ä.) kann Headless-Browser blockieren.
