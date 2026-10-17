'use client';
import { useEffect, useRef, useState } from 'react';
import { EASING_NAMES, PRESETS } from '@glide/core/options';
import {
  DEFAULT_FORM, estimateDuration, fromConfig, newAction, setActionType, SCROLL_ACTIONS, toConfig,
  type ActionType, type FormAction, type FormState, type ViewportMode,
} from '@/lib/form';
import type { Project } from '@/lib/types';
import { Picker } from './Picker';
import { hostOf } from './format';

const COMMON_HIDE = [
  { label: 'Cookiebot', sel: '#CybotCookiebotDialog' },
  { label: 'Usercentrics', sel: '#usercentrics-root' },
  { label: 'Borlabs', sel: '#BorlabsCookieBox' },
  { label: 'CookieYes', sel: '.cky-consent-container' },
  { label: 'OneTrust', sel: '#onetrust-consent-sdk' },
  { label: 'Complianz', sel: '#cmplz-cookiebanner-container' },
  { label: 'Intercom', sel: '.intercom-lightweight-app' },
  { label: 'Tawk', sel: 'iframe[title*="chat" i]' },
];

const EASING_LABELS: Record<string, string> = {
  linear: 'Linear',
  easeInOutSine: 'Sanft (Sine)',
  easeInOutQuad: 'Weich (Quad)',
  easeInOutCubic: 'Standard (Cubic)',
  easeInOutQuart: 'Kräftig (Quart)',
  easeInOutQuint: 'Stark (Quint)',
  easeInOutExpo: 'Dramatisch (Expo)',
  easeOutCubic: 'Schnell rein, sanft raus',
  easeInCubic: 'Sanft rein, schnell raus',
};

interface Props {
  form: FormState;
  setForm: (f: FormState) => void;
  projects: Project[];
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  /** creates a project from the current settings and makes it the active one */
  onCreateProject: (name: string) => Promise<void>;
  /** stores the current settings in the active project */
  onSaveProject: () => Promise<void>;
  onRenameProject: (id: string, name: string) => Promise<void>;
  onDeleteProject: (id: string) => Promise<void>;
  /** the current settings differ from the active project */
  projectDirty: boolean;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

export function RecordForm(p: Props) {
  const { form: f, setForm } = p;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...f, [k]: v });
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const tour = f.kind === 'tour';
  const pickButton = (label = '◎ In der Vorschau auswählen') => (
    <button type="button" className="btn ghost small pick-btn" disabled={!f.url.trim()} onClick={() => setPickerOpen(true)}
      title={f.url.trim() ? undefined : 'Zuerst eine URL eingeben'}>
      {label}
    </button>
  );
  const introOutro = (
    <div className="row">
      <NumberField label={tour ? 'Intro am Anfang' : 'Intro oben'} unit="s" step={0.5} value={f.introDuration} onChange={(v) => set('introDuration', v)} />
      <NumberField label={tour ? 'Outro am Ende' : 'Outro unten'} unit="s" step={0.5} value={f.outroDuration} onChange={(v) => set('outroDuration', v)} />
    </div>
  );
  const easing = (
    <label className="field">
      <span>Easing</span>
      <select value={f.easing} onChange={(e) => set('easing', e.target.value as FormState['easing'])}>
        {EASING_NAMES.map((n) => (
          <option key={n} value={n}>{EASING_LABELS[n] ?? n}</option>
        ))}
      </select>
    </label>
  );

  useEffect(() => {
    if (jsonOpen) setJson(JSON.stringify(toConfig(f), null, 2));
  }, [jsonOpen, f]);

  const hide = f.hideSelectors.split('\n').map((s) => s.trim()).filter(Boolean);
  const toggleHide = (sel: string) =>
    set('hideSelectors', (hide.includes(sel) ? hide.filter((h) => h !== sel) : [...hide, sel]).join('\n'));

  const viewportLabel = (v: ViewportMode) =>
    v === 'custom' ? `${f.width}×${f.height}` : `${PRESETS[v].width}×${PRESETS[v].height}`;

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <h2>Neue Aufnahme</h2>
      <ProjectBar {...p} />

      <label className="field url-field">
        <span>Website</span>
        <input
          type="url"
          inputMode="url"
          required
          placeholder="https://kunde.de"
          value={f.url}
          onChange={(e) => set('url', e.target.value)}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && !/^https?:\/\//i.test(v)) set('url', `https://${v}`);
          }}
        />
      </label>

      <Group title="Gerät">
        <Segmented
          value={f.viewport}
          onChange={(v) => set('viewport', v as ViewportMode)}
          options={(['desktop', 'laptop', 'mobile', 'custom'] as const).map((v) => ({
            value: v,
            label: { desktop: 'Desktop', laptop: 'Laptop', mobile: 'Mobil', custom: 'Eigene' }[v],
            hint: viewportLabel(v),
          }))}
        />
        {f.viewport === 'custom' && (
          <div className="row">
            <NumberField label="Breite" unit="px" value={f.width} min={200} onChange={(v) => set('width', v)} />
            <NumberField label="Höhe" unit="px" value={f.height} min={200} onChange={(v) => set('height', v)} />
          </div>
        )}
      </Group>

      <Group title="Art">
        <Segmented
          value={f.kind}
          onChange={(v) => set('kind', v as FormState['kind'])}
          options={[
            { value: 'scroll', label: 'Scroll-Video', hint: 'durchgehend oder Sections' },
            { value: 'tour', label: 'Klick-Tour', hint: 'Unterseiten & Dialoge' },
          ]}
        />
      </Group>

      {tour ? (
        <Group title="Tour">
          {pickButton('◎ In der Vorschau durchklicken')}
          <ActionList tour actions={f.actions} onChange={(a) => set('actions', a)} />
          <div className="row">
            <NumberField label="Scroll-Tempo" unit="px/s" min={1} value={f.speed} onChange={(v) => set('speed', v)} />
            {easing}
          </div>
          {introOutro}
          <p className="hint">Videolänge: {estimateDuration(f)}</p>
        </Group>
      ) : (
      <>
      <Group title="Scrollen">
        <Segmented
          value={f.mode}
          onChange={(v) => set('mode', v as FormState['mode'])}
          options={[
            { value: 'continuous', label: 'Durchgehend', hint: 'einmal komplett' },
            { value: 'sections', label: 'Sections', hint: 'mit Pausen' },
          ]}
        />
        <div className="row">
          <label className="field">
            <span>Tempo</span>
            <div className="input-combo">
              {/* step "any": a step grid starts at min, so min 1 + step 50 made 600 px/s invalid and blocked the form */}
              <input
                type="number"
                min={1}
                step="any"
                value={f.tempo === 'speed' ? f.speed : f.duration}
                onChange={(e) => set(f.tempo === 'speed' ? 'speed' : 'duration', Number(e.target.value))}
              />
              <select value={f.tempo} onChange={(e) => set('tempo', e.target.value as FormState['tempo'])}>
                <option value="speed">px/s</option>
                <option value="duration">Sek. gesamt</option>
              </select>
            </div>
          </label>
          {easing}
        </div>
        {f.mode === 'sections' && (
          <>
            <div className="row">
              <NumberField label="Pause je Section" unit="s" step={0.1} value={f.pauseDuration} onChange={(v) => set('pauseDuration', v)} />
              <NumberField label="Abstand oben" unit="px" value={f.sectionOffset} onChange={(v) => set('sectionOffset', v)} />
            </div>
            <label className="field">
              <span>Section-Selektoren <em>leer = automatisch (header, section, footer)</em></span>
              <textarea rows={2} placeholder={'main > section\nfooter'} value={f.sections} onChange={(e) => set('sections', e.target.value)} />
            </label>
          </>
        )}
        {introOutro}
        <p className="hint">Videolänge: {estimateDuration(f)}</p>
      </Group>

      <Group title="Hover, Klicks & Eingaben">
        {pickButton()}
        <ActionList actions={f.actions} onChange={(a) => set('actions', a)} />
      </Group>
      </>
      )}

      <Group title="Ausblenden">
        {pickButton()}
        <div className="chips">
          {COMMON_HIDE.map((c) => (
            <button
              type="button"
              key={c.sel}
              className={`chip ${hide.includes(c.sel) ? 'on' : ''}`}
              onClick={() => toggleHide(c.sel)}
              title={c.sel}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>CSS-Selektoren <em>einer pro Zeile</em></span>
          <textarea rows={2} placeholder="#cookie-banner" value={f.hideSelectors} onChange={(e) => set('hideSelectors', e.target.value)} />
        </label>
      </Group>

      <Group title="Ausgabe">
        <div className="row three">
          <label className="field">
            <span>Framerate</span>
            <select value={f.fps} onChange={(e) => set('fps', Number(e.target.value))}>
              <option value={30}>30 fps</option>
              <option value={50}>50 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={f.format} onChange={(e) => set('format', e.target.value as FormState['format'])}>
              <option value="mp4">MP4</option>
              <option value="webm">WebM</option>
            </select>
          </label>
          <label className="field">
            <span>Schärfe</span>
            <select value={f.deviceScaleFactor} onChange={(e) => set('deviceScaleFactor', Number(e.target.value))}>
              <option value={1}>1× schnell</option>
              <option value={2}>2× scharf</option>
              <option value={3}>3× extra</option>
            </select>
          </label>
        </div>
      </Group>

      <details className="advanced">
        <summary>Erweitert</summary>
        <div className="row">
          <label className="field">
            <span>Scroll-Treiber</span>
            <select value={f.scrollDriver} onChange={(e) => set('scrollDriver', e.target.value as FormState['scrollDriver'])}>
              <option value="auto">Automatisch</option>
              <option value="native">Nativ</option>
              <option value="lenis">Lenis</option>
              <option value="custom">Eigener Hook</option>
            </select>
          </label>
          <label className="field">
            <span>Lenis-Pfad</span>
            <input value={f.lenisPath} onChange={(e) => set('lenisPath', e.target.value)} placeholder="lenis" />
          </label>
          <label className="field">
            <span>Scroll-Container <em>leer = automatisch, none = Dokument</em></span>
            <input className="mono" value={f.scrollContainer} onChange={(e) => set('scrollContainer', e.target.value)} placeholder="auto" />
          </label>
        </div>
        {f.scrollDriver === 'custom' && (
          <label className="field">
            <span>Scroll-Hook <em>JS-Funktion, bekommt y</em></span>
            <textarea className="mono" rows={3} required value={f.scrollHook}
              placeholder={"(y) => { document.querySelector('.scroller').scrollTop = y }"}
              onChange={(e) => set('scrollHook', e.target.value)} />
          </label>
        )}
        {tour && (
          <NumberField label="Abstand oben beim Scrollen zu Ankern und Elementen" unit="px" value={f.sectionOffset} onChange={(v) => set('sectionOffset', v)} />
        )}
        <div className="row">
          <NumberField label="Warm-up" unit="s" step={0.5} value={f.warmup} onChange={(v) => set('warmup', v)} />
          <NumberField label="Max. Länge" unit="s" value={f.maxDuration} min={1} onChange={(v) => set('maxDuration', v)} />
        </div>
        <div className="row">
          <label className="field">
            <span>Videogröße <em>leer = automatisch</em></span>
            <div className="input-combo pair">
              <input inputMode="numeric" placeholder="Breite" value={f.outputWidth} onChange={(e) => set('outputWidth', e.target.value.replace(/\D/g, ''))} />
              <input inputMode="numeric" placeholder="Höhe" value={f.outputHeight} onChange={(e) => set('outputHeight', e.target.value.replace(/\D/g, ''))} />
            </div>
          </label>
          <label className="field">
            <span>Browser</span>
            <select value={f.browser} onChange={(e) => set('browser', e.target.value as FormState['browser'])}>
              <option value="chromium">Chromium (mitgeliefert)</option>
              <option value="chrome">Google Chrome (H.264-Videos)</option>
              <option value="msedge">Microsoft Edge</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.prepass} onChange={(e) => set('prepass', e.target.checked)} />
          Vorlauf: einmal durchscrollen, damit Lazy-Loading-Bilder geladen sind
        </label>
        <label className="field">
          <span>Eigenes CSS</span>
          <textarea className="mono" rows={2} value={f.injectCss} onChange={(e) => set('injectCss', e.target.value)} placeholder=".promo-bar { display: none }" />
        </label>
      </details>

      <details className="advanced" open={jsonOpen} onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Config als JSON <em>kompatibel mit der CLI</em></summary>
        <textarea className="mono json" rows={12} value={json} spellCheck={false} onChange={(e) => { setJson(e.target.value); setJsonError(null); }} />
        {jsonError && <p className="error">{jsonError}</p>}
        <div className="row-buttons">
          <button type="button" className="btn ghost" onClick={() => {
            try {
              setForm(fromConfig(JSON.parse(json), f.name));
              setJsonError(null);
            } catch (e) {
              setJsonError(`Ungültiges JSON: ${(e as Error).message}`);
            }
          }}>Übernehmen</button>
          <button type="button" className="btn ghost" onClick={() => navigator.clipboard?.writeText(json)}>Kopieren</button>
          <label className="btn ghost file-btn">
            Datei laden
            <input type="file" accept="application/json,.json" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setForm(fromConfig(JSON.parse(await file.text()), file.name.replace(/\.json$/i, '')));
              } catch (err) {
                setJsonError(`Datei konnte nicht gelesen werden: ${(err as Error).message}`);
              }
              e.target.value = '';
            }} />
          </label>
        </div>
      </details>

      {pickerOpen && <Picker form={f} setForm={setForm} onClose={() => setPickerOpen(false)} />}

      {p.error && <p className="error" role="alert">{p.error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn primary big" disabled={p.submitting || !f.url.trim()}>
          {p.submitting ? 'Wird gestartet…' : 'Aufnahme starten'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setForm({ ...DEFAULT_FORM, url: f.url })}>
          Zurücksetzen
        </button>
      </div>
    </form>
  );
}

const NEW = '__new__';

function ProjectBar(p: Props) {
  const current = p.projects.find((x) => x.id === p.projectId);
  // naming a new project or renaming the active one
  const [editing, setEditing] = useState<{ kind: 'new' | 'rename'; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    const name = editing?.name.trim();
    if (!editing || !name) return;
    if (editing.kind === 'new') void run(() => p.onCreateProject(name));
    else if (current) void run(() => p.onRenameProject(current.id, name));
  };

  if (editing) {
    return (
      <div className="project-bar">
        <div className="project-edit">
          <input
            ref={input}
            aria-label="Projektname"
            placeholder="Projektname, z. B. Kunde GmbH"
            value={editing.name}
            disabled={busy}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => {
              // Enter must not submit the recording form
              if (e.key === 'Enter') { e.preventDefault(); confirm(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
            }}
          />
          <button type="button" className="btn primary small" disabled={busy || !editing.name.trim()} onClick={confirm}>
            {editing.kind === 'new' ? 'Anlegen' : 'Umbenennen'}
          </button>
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => setEditing(null)}>Abbrechen</button>
        </div>
        {editing.kind === 'new' && <p className="hint">Übernimmt die aktuellen Einstellungen. Neue Aufnahmen landen dann in diesem Projekt.</p>}
        {error && <p className="error small" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="project-bar">
      <div className="project-row">
        <select
          aria-label="Projekt"
          value={current?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW) {
              setEditing({ kind: 'new', name: hostOf(p.form.url) });
              return;
            }
            const pr = p.projects.find((x) => x.id === v);
            p.setProjectId(pr?.id ?? null);
            if (pr) p.setForm(fromConfig(pr.config, pr.name));
          }}
        >
          <option value="">Ohne Projekt</option>
          {p.projects.length > 0 && (
            <optgroup label="Projekte">
              {p.projects.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </optgroup>
          )}
          <option value={NEW}>＋ Neues Projekt…</option>
        </select>
        {!current && (
          <button type="button" className="btn ghost small" onClick={() => setEditing({ kind: 'new', name: hostOf(p.form.url) })}>
            ＋ Neues Projekt
          </button>
        )}
        {current && (
          <>
            {p.projectDirty ? (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => void run(p.onSaveProject)}
                title="Es gibt ungespeicherte Änderungen – im Projekt speichern">
                <span className="dirty-dot" aria-hidden="true" />Speichern
              </button>
            ) : (
              <span className="project-state small muted">✓ gespeichert</span>
            )}
            <button type="button" className="btn ghost small icon" aria-label="Projekt umbenennen" title="Umbenennen"
              onClick={() => setEditing({ kind: 'rename', name: current.name })}>✎</button>
            <button type="button" className="btn ghost small icon danger" aria-label="Projekt löschen" title="Löschen"
              onClick={() => {
                if (window.confirm(`Projekt „${current.name}“ löschen? Die Videos bleiben erhalten.`)) void run(() => p.onDeleteProject(current.id));
              }}>✕</button>
          </>
        )}
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}

const STEP_LABELS: Record<ActionType, string> = {
  hover: 'Hover', click: 'Klick', type: 'Text', scroll: 'Scrollen', wait: 'Pause', goto: 'Seite', press: 'Taste',
};
const KEYS = ['Escape', 'Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', ' '];

function ActionList({ actions, onChange, tour = false }: { actions: FormAction[]; onChange: (a: FormAction[]) => void; tour?: boolean }) {
  const update = (i: number, patch: Partial<FormAction>) =>
    onChange(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = (type: ActionType) => onChange([...actions, newAction(type)]);
  const swap = (i: number, j: number) => {
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const types: ActionType[] = tour ? ['click', 'hover', 'type', 'scroll', 'wait', 'goto', 'press'] : [...SCROLL_ACTIONS];
  // a scroll video keeps tour steps in the form (switching back brings them back), but does not show them
  const shown = actions.map((a, i) => ({ a, i })).filter(({ a }) => tour || SCROLL_ACTIONS.includes(a.type));
  const hiddenSteps = actions.length - shown.length;
  return (
    <>
      {shown.length > 0 && (
        <ol className="actions">
          {shown.map(({ a, i }, n) => (
            <li key={i} className="action">
              <select aria-label="Aktion" value={a.type}
                onChange={(e) => onChange(actions.map((x, j) => (j === i ? setActionType(x, e.target.value as ActionType) : x)))}>
                {types.map((t) => <option key={t} value={t}>{tour ? `${n + 1}. ` : ''}{STEP_LABELS[t]}</option>)}
              </select>
              <StepTarget a={a} update={(patch) => update(i, patch)} />
              <div className="input-unit">
                <input aria-label={a.type === 'wait' ? 'Pause' : 'Dauer'} type="number" min={0} step={0.5} value={a.duration}
                  onChange={(e) => update(i, { duration: e.target.value === '' ? 0 : Number(e.target.value) })} />
                <span>s</span>
              </div>
              <div className="action-ctl">
                {tour && (
                  <>
                    <button type="button" className="btn ghost small icon" aria-label="Nach oben" title="Nach oben" disabled={n === 0}
                      onClick={() => swap(i, shown[n - 1].i)}>↑</button>
                    <button type="button" className="btn ghost small icon" aria-label="Nach unten" title="Nach unten" disabled={n === shown.length - 1}
                      onClick={() => swap(i, shown[n + 1].i)}>↓</button>
                  </>
                )}
                <button type="button" className="btn ghost small danger" aria-label="Entfernen"
                  onClick={() => onChange(actions.filter((_, j) => j !== i))}>✕</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="row-buttons">
        {types.map((t) => (
          <button key={t} type="button" className="btn ghost small" onClick={() => add(t)}>+ {STEP_LABELS[t]}</button>
        ))}
      </div>
      {tour ? (
        <p className="hint">
          Die Schritte laufen der Reihe nach ab. Glide scrollt nur, wenn ein Element nicht im Bild ist, und wartet kurz auf Elemente,
          die erst erscheinen (Dialoge, nachgeladene Inhalte). Links öffnen die Unterseite im selben Tab, das Video schneidet dorthin,
          danach steht die Seite für die Dauer des Klicks. „Taste“ drückt z. B. Escape, um einen Dialog zu schließen.
        </p>
      ) : (
        <p className="hint">
          Das Scrollen hält an jedem Element an, ein Cursor fährt hin und hovert, klickt oder klickt ins Feld und tippt den Text ein
          (vorhandener Text wird ersetzt). Reihenfolge: von oben nach unten. Links und Formulare öffnen keine neue Seite.
          Mit „Text (optional)“ wählst du bei Hover und Klick unter mehreren Treffern das Element mit diesem Text.
          {hiddenSteps > 0 && ` ${hiddenSteps} Tour-Schritt(e) (Scrollen, Pause, Seite, Taste) gelten nur in der Klick-Tour.`}
        </p>
      )}
    </>
  );
}

/** The fields of a step that say what it acts on (two grid cells: `main` and `second`). */
function StepTarget({ a, update }: { a: FormAction; update: (patch: Partial<FormAction>) => void }) {
  const selector = (placeholder: string, className = 'main') => (
    <input aria-label="CSS-Selektor" className={`mono ${className}`} placeholder={placeholder} value={a.selector}
      onChange={(e) => update({ selector: e.target.value })} />
  );
  const filter = (
    <input aria-label="Text (optional)" className="second" placeholder="Text (optional)" value={a.text}
      onChange={(e) => update({ text: e.target.value })} />
  );
  switch (a.type) {
    case 'hover':
    case 'click':
      return <>{selector('.button-primary')}{filter}</>;
    case 'type':
      return (
        <>
          {selector('#suche')}
          <input aria-label="Text zum Eintippen" className="second" placeholder="Text zum Eintippen" required value={a.value}
            onChange={(e) => update({ value: e.target.value })} />
        </>
      );
    case 'scroll':
      return (
        <>
          <select aria-label="Scrollen bis" className="main" value={a.to || ''} onChange={(e) => update({ to: e.target.value as FormAction['to'] })}>
            <option value="">zu einem Element</option>
            <option value="top">ganz nach oben</option>
            <option value="bottom">ganz nach unten</option>
          </select>
          {a.to ? <span className="second" /> : selector('#preise', 'second')}
        </>
      );
    case 'goto':
      return (
        <>
          <input aria-label="Seite" className="mono main" inputMode="url" placeholder="/kontakt oder https://…" required value={a.url}
            onChange={(e) => update({ url: e.target.value })} />
          <span className="second small muted">öffnet die Seite</span>
        </>
      );
    case 'press':
      return (
        <>
          <input aria-label="Taste" className="mono main" list="glide-keys" placeholder="Escape" required value={a.key}
            onChange={(e) => update({ key: e.target.value })} />
          <datalist id="glide-keys">{KEYS.map((k) => <option key={k} value={k} />)}</datalist>
          <span className="second small muted">z. B. Escape, Enter, Tab</span>
        </>
      );
    case 'wait':
      return <><span className="main small muted">Seite steht still, Animationen laufen weiter</span><span className="second" /></>;
  }
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Segmented(props: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          key={o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          <strong>{o.label}</strong>
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

function NumberField(props: {
  label: string;
  unit?: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <div className="input-unit">
        <input
          type="number"
          step={props.step ?? 1}
          min={props.min ?? 0}
          value={Number.isFinite(props.value) ? props.value : ''}
          onChange={(e) => props.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        {props.unit && <span>{props.unit}</span>}
      </div>
    </label>
  );
}
