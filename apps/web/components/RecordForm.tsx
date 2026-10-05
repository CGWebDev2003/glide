'use client';
import { useEffect, useRef, useState } from 'react';
import { EASING_NAMES, PRESETS } from '@glide/core/options';
import { DEFAULT_FORM, estimateDuration, fromConfig, toConfig, type FormAction, type FormState, type ViewportMode } from '@/lib/form';
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
  const pickButton = (
    <button type="button" className="btn ghost small pick-btn" disabled={!f.url.trim()} onClick={() => setPickerOpen(true)}
      title={f.url.trim() ? undefined : 'Zuerst eine URL eingeben'}>
      ◎ In der Vorschau auswählen
    </button>
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
              <input
                type="number"
                min={1}
                step={f.tempo === 'speed' ? 50 : 1}
                value={f.tempo === 'speed' ? f.speed : f.duration}
                onChange={(e) => set(f.tempo === 'speed' ? 'speed' : 'duration', Number(e.target.value))}
              />
              <select value={f.tempo} onChange={(e) => set('tempo', e.target.value as FormState['tempo'])}>
                <option value="speed">px/s</option>
                <option value="duration">Sek. gesamt</option>
              </select>
            </div>
          </label>
          <label className="field">
            <span>Easing</span>
            <select value={f.easing} onChange={(e) => set('easing', e.target.value as FormState['easing'])}>
              {EASING_NAMES.map((n) => (
                <option key={n} value={n}>{EASING_LABELS[n] ?? n}</option>
              ))}
            </select>
          </label>
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
        <div className="row">
          <NumberField label="Intro oben" unit="s" step={0.5} value={f.introDuration} onChange={(v) => set('introDuration', v)} />
          <NumberField label="Outro unten" unit="s" step={0.5} value={f.outroDuration} onChange={(v) => set('outroDuration', v)} />
        </div>
        <p className="hint">Videolänge: {estimateDuration(f)}</p>
      </Group>

      <Group title="Ausblenden">
        {pickButton}
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

      <Group title="Hover & Klicks">
        {pickButton}
        <ActionList actions={f.actions} onChange={(a) => set('actions', a)} />
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

function ActionList({ actions, onChange }: { actions: FormAction[]; onChange: (a: FormAction[]) => void }) {
  const update = (i: number, patch: Partial<FormAction>) =>
    onChange(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = (type: FormAction['type']) =>
    onChange([...actions, { type, selector: '', text: '', duration: type === 'click' ? 2 : 1.5, extra: {} }]);
  return (
    <>
      {actions.length > 0 && (
        <ol className="actions">
          {actions.map((a, i) => (
            <li key={i} className="action">
              <select aria-label="Aktion" value={a.type} onChange={(e) => update(i, { type: e.target.value as FormAction['type'] })}>
                <option value="hover">Hover</option>
                <option value="click">Klick</option>
              </select>
              <input aria-label="CSS-Selektor" className="mono" placeholder=".button-primary" value={a.selector}
                onChange={(e) => update(i, { selector: e.target.value })} />
              <input aria-label="Text (optional)" placeholder="Text (optional)" value={a.text}
                onChange={(e) => update(i, { text: e.target.value })} />
              <div className="input-unit">
                <input aria-label="Dauer" type="number" min={0} step={0.5} value={a.duration}
                  onChange={(e) => update(i, { duration: e.target.value === '' ? 0 : Number(e.target.value) })} />
                <span>s</span>
              </div>
              <button type="button" className="btn ghost small danger" aria-label="Entfernen"
                onClick={() => onChange(actions.filter((_, j) => j !== i))}>✕</button>
            </li>
          ))}
        </ol>
      )}
      <div className="row-buttons">
        <button type="button" className="btn ghost small" onClick={() => add('hover')}>+ Hover</button>
        <button type="button" className="btn ghost small" onClick={() => add('click')}>+ Klick</button>
      </div>
      <p className="hint">
        Das Scrollen hält an jedem Element an, ein Cursor fährt hin und hovert oder klickt. Reihenfolge: von oben nach unten.
        Links und Formulare öffnen keine neue Seite. Mit „Text“ wählst du unter mehreren Treffern das Element mit diesem Text.
      </p>
    </>
  );
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
