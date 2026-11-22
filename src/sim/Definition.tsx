import { parse } from 'mathjs';
import { useMemo, useState } from 'react';
import { symbolToLatex } from '../core/expr';
import type { OdeModel, SolverMethod } from '../core/ode';
import { confirmDiscard, historyFor, newDocument, openDocument, saveDocument } from '../documents';
import { NumberField } from '../components/NumberField';
import { Tex } from '../components/Tex';
import { UndoRedo } from '../components/UndoRedo';
import { MODELS } from './models';
import { markSimSaved, useSim } from './store';

function Section({ title, count, children, defaultOpen = true, action }: {
  title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="def-section">
      <div className="def-head">
        <button className="def-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`chev${open ? ' open' : ''}`}>›</span>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </button>
        {open && action}
      </div>
      {open && <div className="def-body">{children}</div>}
    </section>
  );
}

/** Typeset the system exactly as the solver will integrate it. */
function equationsTex(model: OdeModel): string[] {
  const tex = (expr: string) => {
    try {
      return parse(expr).toTex({ parenthesis: 'auto' });
    } catch {
      return `\\text{${expr.replace(/[\\{}$&#^_%~]/g, ' ')}}`;
    }
  };
  return [
    ...model.states.map((s) => `\\dfrac{\\mathrm{d}${symbolToLatex(s.name)}}{\\mathrm{d}t} = ${tex(s.deriv)}`),
    ...model.derived.map((d) => `${symbolToLatex(d.name)} = ${tex(d.expr)}`),
  ];
}

const METHODS: { id: SolverMethod; label: string; hint: string }[] = [
  { id: 'rk45', label: 'RK45 adaptive', hint: 'Dormand–Prince 5(4): the step size adapts to keep the local error under the tolerance' },
  { id: 'ros23', label: 'Rosenbrock23 adaptive (stiff)', hint: 'Linearly implicit 2(3) pair with a numerical Jacobian — for stiff systems where explicit methods need tiny steps' },
  { id: 'rk4', label: 'RK4 fixed step', hint: 'Classic 4th-order Runge–Kutta with a constant step' },
  { id: 'euler', label: 'Euler fixed step', hint: 'First order — mainly useful for seeing how integration error behaves' },
];

/** Left panel: everything that defines the system being simulated. */
export function Definition() {
  const model = useSim((s) => s.model);
  const patch = useSim((s) => s.patch);
  const filePath = useSim((s) => s.filePath);
  const dirty = useSim((s) => s.dirty);
  const [configure, setConfigure] = useState(false);
  const eqs = useMemo(() => equationsTex(model), [model]);
  const method = model.method ?? 'rk4';

  const setState = (i: number, p: Partial<OdeModel['states'][number]>) =>
    patch({ states: model.states.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setParam = (i: number, p: Partial<OdeModel['params'][number]>) =>
    patch({ params: model.params.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const setDerived = (i: number, p: Partial<OdeModel['derived'][number]>) =>
    patch({ derived: model.derived.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const fileName = filePath?.split(/[\\/]/).pop();

  return (
    <aside className="sim-side">
      <div className="def-top">
        <input className="doc-name" value={model.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Simulation name" />
        <div className="def-file">
          <span className="file-status" title={filePath ?? 'Not saved to a file yet'}>{fileName ?? 'Unsaved'}{dirty ? ' • edited' : ''}</span>
          <span className="spacer" />
          <UndoRedo kind="sim" />
          <button className="btn small" onClick={() => newDocument('sim')} title="Start a blank simulation">New</button>
          <button className="btn small" onClick={() => void openDocument()}>Open</button>
          <button className="btn small" onClick={() => void saveDocument('sim')}>Save</button>
        </div>
        <select
          className="template" value="" aria-label="Start from a template"
          onChange={(e) => {
            const m = MODELS.find((x) => x.id === e.target.value);
            if (m && confirmDiscard('sim')) {
              useSim.getState().load(m);
              markSimSaved(null);
              historyFor('sim').reset();
            }
          }}
        >
          <option value="" disabled>Start from a template…</option>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      <div className="sim-side-scroll">
        <Section title="System" count={model.states.length}>
          <div className="equations">{eqs.map((e, i) => <Tex key={i} block tex={e} />)}</div>
          {model.states.map((s, i) => (
            <div className="ed-block" key={i}>
              <div className="ed-row">
                <input className="code name" value={s.name} onChange={(e) => setState(i, { name: e.target.value })} aria-label="State variable name" spellCheck={false} />
                <span className="muted">at t = 0:</span>
                <input className="code" value={s.init} onChange={(e) => setState(i, { init: e.target.value })} aria-label={`Initial value of ${s.name}`} spellCheck={false} />
                <input className="code unit" value={s.unit ?? ''} placeholder="unit" onChange={(e) => setState(i, { unit: e.target.value || undefined })} aria-label={`Unit of ${s.name}`} />
                <button className="btn icon" title="Remove state variable" onClick={() => patch({ states: model.states.filter((_, j) => j !== i) })}>×</button>
              </div>
              <div className="ed-row">
                <span className="muted rate">d{s.name}/dt =</span>
                <input className="code" value={s.deriv} onChange={(e) => setState(i, { deriv: e.target.value })} aria-label={`Rate of change of ${s.name}`} spellCheck={false} />
              </div>
            </div>
          ))}
          <button className="btn small" onClick={() => patch({ states: [...model.states, { name: `s${model.states.length + 1}`, init: '0', deriv: '0' }] })}>+ State variable</button>
          <p className="muted help">Expressions may use time <code>t</code>, parameters, state variables and functions such as <code>sin</code>, <code>sqrt</code>, <code>exp</code>, <code>abs</code>. Initial values may reference parameters.</p>
        </Section>

        <Section
          title="Parameters" count={model.params.length}
          action={<button className="link" onClick={() => setConfigure(!configure)}>{configure ? 'Done' : 'Configure'}</button>}
        >
          {model.params.map((p, i) => (
            <div className="param" key={i}>
              {configure ? (
                <>
                  <div className="ed-row">
                    <input className="code name" value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} aria-label="Parameter name" spellCheck={false} />
                    <input value={p.label ?? ''} placeholder="description" onChange={(e) => setParam(i, { label: e.target.value || undefined })} aria-label={`Description of ${p.name}`} />
                    <input className="code unit" value={p.unit ?? ''} placeholder="unit" onChange={(e) => setParam(i, { unit: e.target.value || undefined })} aria-label={`Unit of ${p.name}`} />
                    <button className="btn icon" title="Remove parameter" onClick={() => patch({ params: model.params.filter((_, j) => j !== i) })}>×</button>
                  </div>
                  <div className="ed-row">
                    <span className="muted">range</span>
                    <NumberField className="code" value={p.min} onChange={(min) => setParam(i, { min })} label={`Minimum of ${p.name}`} />
                    <span className="muted">to</span>
                    <NumberField className="code" value={p.max} onChange={(max) => setParam(i, { max })} label={`Maximum of ${p.name}`} />
                  </div>
                </>
              ) : (
                <>
                  <div className="param-head">
                    <span className="param-name" title={p.label}><code>{p.name}</code>{p.label && <span className="muted"> {p.label}</span>}</span>
                    <NumberField className="code param-value" value={p.value} onChange={(value) => setParam(i, { value })} label={`Value of ${p.name}`} />
                    <span className="param-unit muted">{p.unit ?? ''}</span>
                  </div>
                  <input
                    type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 200} value={p.value} aria-label={`${p.label ?? p.name} slider`}
                    onChange={(e) => setParam(i, { value: Number(e.target.value) })}
                  />
                </>
              )}
            </div>
          ))}
          <button className="btn small" onClick={() => { patch({ params: [...model.params, { name: `p${model.params.length + 1}`, value: 1, min: 0, max: 10 }] }); setConfigure(true); }}>+ Parameter</button>
        </Section>

        <Section title="Observables" count={model.derived.length}>
          {model.derived.map((d, i) => (
            <div className="ed-row" key={i}>
              <input className="code name" value={d.name} onChange={(e) => setDerived(i, { name: e.target.value })} aria-label="Observable name" spellCheck={false} />
              <span className="muted">=</span>
              <input className="code" value={d.expr} onChange={(e) => setDerived(i, { expr: e.target.value })} aria-label={`Expression for ${d.name}`} spellCheck={false} />
              <input className="code unit" value={d.unit ?? ''} placeholder="unit" onChange={(e) => setDerived(i, { unit: e.target.value || undefined })} aria-label={`Unit of ${d.name}`} />
              <button className="btn icon" title="Remove observable" onClick={() => patch({ derived: model.derived.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="btn small" onClick={() => patch({ derived: [...model.derived, { name: `q${model.derived.length + 1}`, expr: '0' }] })}>+ Observable</button>
          <p className="muted help">Quantities computed from the state at every step — energies, invariants, anything you want to chart or measure.</p>
        </Section>

        <Section title="Solver">
          <div className="ed-row">
            <span className="muted">method</span>
            <select value={method} onChange={(e) => patch({ method: e.target.value as SolverMethod })} aria-label="Integration method" title={METHODS.find((m) => m.id === method)?.hint}>
              {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="ed-row">
            <span className="muted">duration</span>
            <NumberField className="code" value={model.tEnd} onChange={(tEnd) => patch({ tEnd })} label="Duration" />
            {method === 'rk45' || method === 'ros23' ? (
              <>
                <span className="muted">tolerance</span>
                <NumberField className="code" value={model.tol ?? (method === 'ros23' ? 1e-6 : 1e-8)} onChange={(tol) => patch({ tol })} label="Relative tolerance" />
              </>
            ) : (
              <>
                <span className="muted">step</span>
                <NumberField className="code" value={model.dt} onChange={(dt) => patch({ dt })} label="Time step" />
              </>
            )}
          </div>
          <div className="ed-row">
            <span className="muted">stop when</span>
            <input className="code" value={model.stopWhen ?? ''} placeholder="optional, e.g. y < 0" onChange={(e) => patch({ stopWhen: e.target.value || undefined })} aria-label="Stop condition" spellCheck={false} />
          </div>
        </Section>

        <Section title="Notes" defaultOpen={!!(model.summary || model.notes)}>
          <textarea
            className="notes" value={model.notes ?? ''} placeholder="Assumptions, references, what to look for…"
            onChange={(e) => patch({ notes: e.target.value })} aria-label="Notes"
          />
          {model.summary && <p className="muted help">{model.summary}</p>}
        </Section>
      </div>
    </aside>
  );
}
