import { useEffect, useMemo, useState } from 'react';
import { Tex } from '../components/Tex';
import { groupLines, type InkLine } from '../core/ink';
import { evaluateNotebook, type LineResult } from '../core/scratch';
import { openGeneratedModel } from '../documents';
import {
  deviceModelInstalled, deviceState, loadSettings, onDeviceState, readLine, saveSettings, startDeviceModel,
  type DeviceState, type RecognitionSettings,
} from '../recognize';
import { InkCanvas, type Tool } from './InkCanvas';
import { useScratch } from './store';

/** How long the pen must rest before a line is read. */
const SETTLE_MS = 900;

function useDeviceState(): DeviceState {
  const [s, setS] = useState(deviceState());
  useEffect(() => onDeviceState(setS), []);
  return s;
}

const ANSWER_KINDS = new Set<LineResult['kind']>(['value', 'defined', 'solved', 'check', 'symbolic']);

export function Scratchpad() {
  const strokes = useScratch((s) => s.strokes);
  const readings = useScratch((s) => s.readings);
  const typed = useScratch((s) => s.typed);
  const canUndo = useScratch((s) => s.past.length > 0);
  const canRedo = useScratch((s) => s.future.length > 0);

  const [tool, setTool] = useState<Tool>('pen');
  const [fingerDraws, setFingerDraws] = useState(true);
  const [penSeen, setPenSeen] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [settings, setSettings] = useState<RecognitionSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const device = useDeviceState();

  useEffect(() => { void deviceModelInstalled().then(setInstalled); }, []);

  const lines = useMemo(() => groupLines(strokes), [strokes]);
  const sources = lines.map((l) => typed[l.key] ?? readings[l.key]?.latex ?? '');
  const sourceKey = JSON.stringify(sources);
  const notebook = useMemo(() => evaluateNotebook(JSON.parse(sourceKey) as string[]), [sourceKey]);

  const reading: 'device' | 'service' | null =
    settings.mode === 'service' ? (settings.serviceUrl.trim() ? 'service' : null)
      : settings.mode === 'device' && installed && device !== 'failed' ? 'device' : null;

  // Load the model as soon as the workspace opens, so the first line is not kept waiting for it.
  useEffect(() => {
    if (reading === 'device' && device === 'idle') void startDeviceModel().catch(() => undefined);
  }, [reading, device]);

  // Read lines once the pen has rested. A line is identified by its ink, so adding to it reads it afresh.
  useEffect(() => {
    useScratch.getState().prune(lines.map((l) => l.key));
    if (!reading) return;
    const todo = lines.filter((l) => typed[l.key] === undefined && !readings[l.key]);
    if (!todo.length) return;
    const timer = setTimeout(() => {
      const { setReading } = useScratch.getState();
      const byId = new Map(strokes.map((s) => [s.id, s]));
      for (const line of todo) {
        setReading(line.key, { pending: true });
        readLine(line.ids.map((id) => byId.get(id)!), settings).then(
          (latex) => setReading(line.key, latex ? { latex } : { error: 'Nothing could be read from this line.' }),
          (err: unknown) => setReading(line.key, { error: err instanceof Error ? err.message : 'This line could not be read.' }),
        );
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [lines, strokes, reading, readings, typed, settings]);

  const inkBottom = lines.length ? Math.max(...lines.map((l) => l.box.y1)) : 0;
  const scrollTo = (y: number) => setScrollY(Math.max(0, Math.min(y, inkBottom + 200)));

  const update = (s: RecognitionSettings) => {
    setSettings(s);
    saveSettings(s);
    // Readings that failed under the old choice deserve another try under the new one.
    useScratch.setState({ readings: Object.fromEntries(Object.entries(useScratch.getState().readings).filter(([, v]) => v.latex !== undefined)) });
  };

  const status =
    settings.mode === 'off' ? 'Handwriting is not being read'
      : settings.mode === 'service' ? (settings.serviceUrl.trim() ? `Read by ${hostOf(settings.serviceUrl)}` : 'No recognition service set')
        : installed === null ? ''
          : !installed ? 'This build has no handwriting model'
            : device === 'loading' ? 'Loading the handwriting model…'
              : device === 'failed' ? 'The handwriting model could not start'
                : 'Read on this device';

  return (
    <div className="scratch">
      <div className="commandbar scratch-bar">
        <div className="seg" role="group" aria-label="Tool">
          <button className={tool === 'pen' ? 'on' : ''} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
          <button className={tool === 'rubber' ? 'on' : ''} aria-pressed={tool === 'rubber'} onClick={() => setTool('rubber')}>Rubber</button>
        </div>
        <button className="btn" disabled={!canUndo} onClick={() => useScratch.getState().undo()}>Undo</button>
        <button className="btn" disabled={!canRedo} onClick={() => useScratch.getState().redo()}>Redo</button>
        <button className="btn" disabled={!strokes.length} onClick={() => { if (confirm('Clear the whole page? Undo brings it back.')) { useScratch.getState().clear(); setScrollY(0); } }}>Clear</button>
        <label className="check" title="A pen always writes. Choose whether a finger writes too, or scrolls the page. Two fingers always scroll.">
          <input type="checkbox" checked={fingerDraws} onChange={(e) => setFingerDraws(e.target.checked)} /> Write with a finger
        </label>
        <span className="spacer" />
        <span className={`scratch-status ${device === 'failed' && settings.mode === 'device' ? 'bad' : ''}`}>{status}</span>
        <button className="btn" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>Handwriting…</button>
      </div>

      <div className="scratch-body">
        <InkCanvas
          strokes={strokes}
          tool={tool}
          fingerDraws={fingerDraws}
          scrollY={scrollY}
          onScroll={scrollTo}
          onPen={() => { if (!penSeen) { setPenSeen(true); setFingerDraws(false); } }}
        >
          {!strokes.length && (
            <div className="ink-hint">
              <b>Write mathematics here.</b>
              <span>End a line with “=” for its value, give a variable a value with “x = 3”, or write an equation to have it solved.</span>
              <span>A differential equation, such as <Tex tex="m\ddot{x} = -kx" />, can be run as a simulation.</span>
            </div>
          )}
          {lines.map((line, i) => <Answer key={line.key} line={line} result={notebook.lines[i]} asked={/=\s*$/.test(sources[i])} pending={!!readings[line.key]?.pending && typed[line.key] === undefined} />)}
        </InkCanvas>

        <aside className="scratch-side">
          {showSettings && <Settings settings={settings} installed={installed} device={device} onChange={update} onClose={() => setShowSettings(false)} />}

          {(notebook.model || notebook.modelNotes.length > 0) && (
            <div className="card scratch-model">
              <h3>Simulation</h3>
              {notebook.model ? (
                <>
                  <p>The differential equations on this page make a model with {notebook.model.states.length} state variable{notebook.model.states.length === 1 ? '' : 's'}.</p>
                  {notebook.modelNotes.length > 0 && <ul className="plain muted">{notebook.modelNotes.map((n) => <li key={n}>{n}</li>)}</ul>}
                  <button className="btn primary" onClick={() => openGeneratedModel(notebook.model!)}>Open in Simulations</button>
                </>
              ) : (
                <p className="scratch-problem">{notebook.modelNotes[0]}</p>
              )}
            </div>
          )}

          <div className="panel-subtitle first">What is on the page</div>
          {!lines.length && <p className="muted">Nothing yet.</p>}
          {lines.map((line, i) => (
            <LineRow
              key={line.key}
              index={i}
              source={sources[i]}
              result={notebook.lines[i]}
              reading={readings[line.key]}
              isTyped={typed[line.key] !== undefined}
              canRead={!!reading}
              editing={editing === line.key}
              onEdit={(on) => setEditing(on ? line.key : null)}
              onType={(latex) => useScratch.getState().setTyped(line.key, latex)}
              onShow={() => scrollTo(line.box.y0 - 60)}
            />
          ))}
        </aside>
      </div>
    </div>
  );
}

const hostOf = (url: string): string => {
  try { return new URL(url).host; } catch { return 'the chosen service'; }
};

/** The answer to a line, set beside the ink that asked for it. */
function Answer({ line, result, pending, asked }: { line: InkLine; result: LineResult | undefined; pending: boolean; asked: boolean }) {
  const { box } = line;
  const height = box.y1 - box.y0;
  const style = { left: box.x1 + 14, top: (box.y0 + box.y1) / 2, fontSize: Math.max(15, Math.min(26, height * 0.55)) };
  if (pending) return <div className="ink-answer reading" style={style} aria-label="Reading this line">…</div>;
  if (!result) return null;
  if (result.kind === 'error') return <div className="ink-answer bad" style={style} title={result.message}>?</div>;
  if (!result.tex || !ANSWER_KINDS.has(result.kind)) return null;
  // Where the writer has already put the "=", the answer follows it without a second one.
  const tex = asked ? result.tex.replace(/^=\s*/, '') : result.tex;
  return <div className={`ink-answer ${result.kind}`} style={style}><Tex tex={tex} /></div>;
}

interface RowProps {
  index: number;
  source: string;
  result: LineResult | undefined;
  reading: { latex?: string; error?: string; pending?: boolean } | undefined;
  isTyped: boolean;
  canRead: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onType: (latex: string | null) => void;
  onShow: () => void;
}

function LineRow({ index, source, result, reading, isTyped, canRead, editing, onEdit, onType, onShow }: RowProps) {
  const [draft, setDraft] = useState(source);
  useEffect(() => { if (!editing) setDraft(source); }, [source, editing]);
  const unread = !source;
  const commit = () => { onType(draft.trim() ? draft.trim() : null); onEdit(false); };

  return (
    <div className={`scratch-line ${result?.kind === 'error' ? 'bad' : ''}`}>
      <button className="scratch-num" onClick={onShow} title="Show this line on the page">{index + 1}</button>
      <div className="scratch-line-body">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); commit(); }}>
            <input className="code" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. x^2 + 1 = 10 or \frac{a}{b}" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={`What line ${index + 1} says`} />
            <div className="scratch-edit-actions">
              <button className="btn small primary" type="submit">Done</button>
              <button className="btn small" type="button" onClick={() => onEdit(false)}>Cancel</button>
              {isTyped && canRead && <button className="btn small" type="button" onClick={() => { onType(null); onEdit(false); }}>Read it again</button>}
            </div>
          </form>
        ) : (
          <>
            <div className="scratch-read">
              {unread
                ? <span className="muted">{reading?.pending ? 'Reading…' : reading?.error ?? (canRead ? 'Waiting for the pen to rest…' : 'Not read')}</span>
                : <Tex tex={source} />}
              <button className="link" onClick={() => onEdit(true)}>{unread ? 'Type it' : 'Correct'}</button>
            </div>
            {!unread && result?.tex && <div className={`scratch-result ${result.kind}`}><Tex tex={result.tex} /></div>}
            {!unread && result?.message && <div className={`scratch-note ${result.kind === 'error' || result.kind === 'waiting' ? 'attention' : ''}`}>{result.message}</div>}
          </>
        )}
      </div>
    </div>
  );
}

interface SettingsProps {
  settings: RecognitionSettings;
  installed: boolean | null;
  device: DeviceState;
  onChange: (s: RecognitionSettings) => void;
  onClose: () => void;
}

function Settings({ settings, installed, device, onChange, onClose }: SettingsProps) {
  return (
    <div className="card scratch-settings">
      <h3>Reading handwriting <button className="btn small" onClick={onClose}>Close</button></h3>
      <label className="radio">
        <input type="radio" name="recog" checked={settings.mode === 'device'} onChange={() => onChange({ ...settings, mode: 'device' })} />
        <span>
          <b>On this device</b>
          <small>
            {installed === false
              ? 'This build of the app does not include the handwriting model. Whoever built it can add it with “npm run setup:handwriting”.'
              : device === 'failed'
                ? 'The model could not start — most likely the device ran short of memory. Close other tabs and reload.'
                : 'Nothing you write leaves the device. The model takes a few seconds to load the first time.'}
          </small>
        </span>
      </label>
      <label className="radio">
        <input type="radio" name="recog" checked={settings.mode === 'service'} onChange={() => onChange({ ...settings, mode: 'service' })} />
        <span>
          <b>A service I choose</b>
          <small>A picture of each line you write is sent to the address below. Use this only with a service you trust; the app is not connected to one of its own.</small>
        </span>
      </label>
      {settings.mode === 'service' && (
        <div className="scratch-service">
          <label className="field"><span>Address</span>
            <input className="code" type="text" inputMode="url" value={settings.serviceUrl} placeholder="https://example.org/recognise" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => onChange({ ...settings, serviceUrl: e.target.value })} />
          </label>
          <label className="field"><span>Key (if it needs one)</span>
            <input className="code" type="password" value={settings.serviceKey} autoComplete="off" onChange={(e) => onChange({ ...settings, serviceKey: e.target.value })} />
          </label>
          <small className="muted">The service receives a PNG by POST and replies with JSON <code>{'{"latex": "…"}'}</code>. The key is kept on this device and sent only to that address. The build must also permit the address — see docs/tablet.md.</small>
        </div>
      )}
      <label className="radio">
        <input type="radio" name="recog" checked={settings.mode === 'off'} onChange={() => onChange({ ...settings, mode: 'off' })} />
        <span>
          <b>Off</b>
          <small>Write freely and type what a line says when you want it worked out.</small>
        </span>
      </label>
    </div>
  );
}
