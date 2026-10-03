# Glide

Nimmt Websites als **perfekt flüssiges Scroll-Video** auf, inklusive CSS-Animationen,
IntersectionObserver-Reveals, GSAP/ScrollTrigger und Lenis. Gedacht für Showcase-Videos
von Kundenwebsites (Portfolio, Instagram, Akquise).

Statt den Bildschirm in Echtzeit aufzunehmen, rendert Glide **deterministisch Frame für Frame**:
Die Zeit im Browser ist virtuell. Pro Frame wird sie um exakt `1/fps` vorgestellt, die
Scrollposition gesetzt und ein Screenshot gemacht. ffmpeg baut daraus das Video. Wie lange die
Aufnahme dauert, spielt keine Rolle: Jeder Frame zeigt exakt den Zustand zu seinem Zeitpunkt.

```bash
glide record kunde.json
glide record --url https://example.com --preset mobile
```

---

## Installation

Voraussetzungen: **Node.js ≥ 18.17** und **ffmpeg** (mit libx264, für WebM zusätzlich libvpx-vp9).

```bash
# ffmpeg
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu/Debian
winget install Gyan.FFmpeg     # Windows

# Glide
git clone <repo> glide && cd glide
npm install                    # baut automatisch nach dist/ (prepare)
npx playwright install chromium
npm link                       # stellt `glide` global bereit
```

Wenn ffmpeg nicht im PATH liegt: `GLIDE_FFMPEG=/pfad/zu/ffmpeg glide record …`.
Fehlen ffmpeg oder der Encoder, bricht Glide vor dem Laden der Seite mit einer
Installationsanleitung ab.

## Benutzung

```bash
# Schnelltest ohne Config
glide record --url https://kunde.de --preset mobile
glide record --url https://kunde.de --mode sections --pause 1.5 --hide "#cookie-banner"

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

Weitere Beispiele: [`examples/kunde-desktop.json`](examples/kunde-desktop.json),
[`examples/kunde-instagram.json`](examples/kunde-instagram.json) (9:16, 1080×1920).

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

## Ablauf einer Aufnahme

1. Chromium (headless) starten. Vor jedem Seitenskript wird die Runtime injiziert (virtuelle Uhr), und die Animations-Timeline wird per CDP eingefroren.
2. Seite laden, auf `load`, `networkidle`, `document.fonts.ready` und Bilder warten.
3. **Pre-Pass** (optional): einmal in Etappen durchscrollen, damit Lazy-Loading-Bilder im Cache landen, danach neu laden. Intro- und Once-Animationen starten dadurch frisch.
4. Elemente ausblenden, CSS/JS injizieren, Scroll-Treiber wählen.
5. **Intro**: oben stehen bleiben (`introDuration`).
6. Erst jetzt werden Seitenhöhe und Section-Positionen gemessen (GSAP-Pins und nachgeladene Inhalte haben sich dann gesetzt), und der Scroll-Zeitplan wird gebaut.
7. **Scrollen** (`continuous` oder `sections`), danach **Outro**.
8. Jeder Frame: `__glide.frame(y, 1000/fps)` → `Page.captureScreenshot` (CDP) → per Pipe direkt in ffmpegs stdin (keine Einzelbilder auf der Platte).

## Architektur

```
src/
  cli.ts            CLI (commander), Fortschrittsanzeige, Fehlermeldungen
  config.ts         Schema (zod), Presets, Output-Größe
  timeline.ts       reiner Scroll-Zeitplan: hold/move-Segmente, Easing, Sections, maxDuration
  easing.ts         Easing-Funktionen
  recorder.ts       Playwright-Ablauf, CDP, Treiberwahl, Frame-Loop
  ffmpeg.ts         Prüfung, Encoder-Argumente, Streaming über stdin mit Backpressure
  page/runtime.ts   In-Page-Runtime (virtuelle Zeit, Animationen, Videos, Scroll-Treiber)
test/
  site/index.html   Testseite: Keyframes, IO + Transition, GSAP ScrollTrigger (scrub, pin, toggleActions), Lenis, Lazy Images
  e2e.ts            nimmt die Testseite auf und prüft jeden Frame (siehe unten)
  *.test.ts         Unit-Tests (Zeitplan, Config, Encoder)
```

### Was ein Frame genau macht (`page/runtime.ts`)

1. Scrollposition setzen (nativ: `scrollTo({behavior:'instant'})`; Lenis: `lenis.scrollTo(y, {immediate:true, force:true})`; custom: Hook)
2. Zwei echte Browser-Frames abwarten: Der Browser feuert `scroll`-Events, berechnet IntersectionObserver und ruft deren Callbacks auf (z. B. `.in`-Klassen für Reveals)
3. Virtuelle Timer bis `t + 1/fps` in zeitlicher Reihenfolge ausführen
4. Virtuelle `requestAnimationFrame`-Callbacks ausführen (GSAP-Ticker → ScrollTrigger, Lenis `raf`)
5. Alle Web Animations (CSS-Animationen, -Transitions, `element.animate`) auf die virtuelle Zeit setzen
6. `<video>` seeken, auf Bilder im Sichtbereich und Fonts warten
7. Node macht den Screenshot

### Übernommene Muster aus timesnap/timecut/timeweb

[timesnap](https://github.com/tungs/timesnap) und [timeweb](https://github.com/tungs/timeweb) überschreiben vor dem Laden der Seite `Date`, `Date.now`, `performance.now`, `requestAnimationFrame` und `setTimeout`/`setInterval` und führen fällige Timer beim Vorspulen in zeitlicher Reihenfolge aus. glide macht es genauso und ergänzt `requestIdleCallback` sowie ein deterministisches `Math.random`. Ebenfalls von dort übernommen: Frames per stdout/Pipe an ffmpeg streamen. timesnap selbst nennt CSS-Animationen und -Transitions als Grenze. timeweb ergänzt dafür `document.getAnimations()` mit Pausieren und Seeken sowie das Pausieren und Seeken von Videos; diesen Ansatz nutzt glide hier auch.

### Entscheidung: Web Animations API + CDP-Freeze (Hybrid)

- **Nur CDP Animation Domain** (`Animation.animationStarted` + `seekAnimations`): Neue Animationen kommen als asynchrone Events mit IDs an, also mit einem Wettlauf zwischen Event und Screenshot. `seekAnimations` greift nur bei pausierten Animationen, `animationend`/`transitionend` feuern nicht, und WAAPI-Animationen von Bibliotheken (z. B. Motion) lassen sich schlechter abdecken. Für das Seeken ist das zu unzuverlässig.
- **Nur Web Animations API** (`document.getAnimations()` → pausieren → `currentTime` setzen): synchron im selben Tick, deckt CSS-Animationen, Transitions und `element.animate` ab, und Animationen ohne Dokument-Timeline (CSS Scroll-driven Animations) bleiben unberührt. **Aber:** Zwischen Seitenstart und erstem Frame laufen Animationen in Echtzeit. Bei langsam ladenden Seiten ist eine Hero-Animation ohne `fill-mode` dann schon vorbei und taucht in `getAnimations()` gar nicht mehr auf.
- **Gewählt: Hybrid.** Per CDP wird nur `Animation.setPlaybackRate(0)` gesetzt. Damit steht die Dokument-Timeline still, und keine Animation kann in Echtzeit fortschreiten, auch nicht während des Ladens. Geseekt wird ausschließlich synchron über die Web Animations API. Ist eine Animation zeitlich fertig, ruft glide `finish()` auf, damit `animationend`/`transitionend` feuern.
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
npm run test:site # Testseite unter http://127.0.0.1:4173 (?lenis=0 ohne Lenis)
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
- **Determinismus**: zwei Aufnahmen sind Frame für Frame identisch (`ffmpeg -f framemd5`; bei Videoframes auf der Seite ist ein Rundungsrauschen von > 40 dB PSNR erlaubt)

Zusätzlich schreibt der Test Kontaktbögen (`test/out/sheet-*.png`) zum Anschauen.

## Bekannte Grenzen

- **Videos auf der Seite**: werden pausiert und pro Frame auf die virtuelle Zeit geseekt. Das klappt bei normalen MP4/WebM-Dateien, sofern der Server HTTP-Range-Requests unterstützt (Standard bei Webservern und CDNs); ohne Range-Support kann der Browser nicht seeken. Das gebündelte Playwright-Chromium spielt **kein H.264/AAC** ab, dafür `"browser": "chrome"` setzen. Decodierte Videoframes können zwischen zwei Läufen um wenige LSB abweichen (nicht sichtbar). HLS/DASH-Streams (MSE) seeken oft ungenau oder langsam. Ton wird nie aufgenommen.
- **WebGL / Canvas / Three.js**: Alles, was über `requestAnimationFrame` und `performance.now` läuft, folgt der virtuellen Zeit. Headless-Chromium rendert WebGL aber per Software (SwiftShader). Das ist langsam, und manche Shader sehen anders aus. Bei Bedarf `headful: true` auf einem Rechner mit GPU verwenden.
- **Web Worker, OffscreenCanvas in Workern, Audio-Worklets** sehen die echte Zeit.
- **iframes** (z. B. eingebettete YouTube-/Maps-Embeds) haben eigene Uhren, die nicht vorgestellt werden.
- `event.timeStamp` und `document.timeline.currentTime` liefern die echte bzw. eingefrorene Zeit.
- Bibliotheken, die Geschwindigkeit aus echten Scroll-Event-Zeitstempeln berechnen (Velocity-Skew-Effekte), können anders aussehen als im echten Browser.
- CSS `animation-play-state`, das sich *nach* dem Start einer Animation per Klasse ändert, wird nicht respektiert (die Animation wird per API gesteuert). JS-seitiges `animation.pause()/play()` wird dagegen respektiert.
- Seiten, die in einem eigenen Container statt im Dokument scrollen: `scrollDriver: "custom"` mit Hook verwenden, z. B. `"(y) => { document.querySelector('.scroller').scrollTop = y }"`.
- Lenis wird nur gefunden, wenn die Instanz auf `window` erreichbar ist (`window.lenis = lenis` oder `lenisPath`). Sonst warnt Glide und scrollt nativ, was mit Lenis meist trotzdem funktioniert.
- Preloader, die auf Timer warten, laufen in virtueller Zeit, also sichtbar im Intro. Mit `warmup` überspringen.
- Bot-Schutz (Cloudflare o. Ä.) kann Headless-Browser blockieren.
