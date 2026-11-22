import { useMemo, useState } from 'react';
import { simulate } from '../core/ode';
import { Definition } from './Definition';
import { ExperimentView } from './ExperimentView';
import { FitView } from './FitView';
import { RunView } from './RunView';
import { useSim } from './store';

const VIEWS = [
  { id: 'run', name: 'Run', hint: 'Integrate the system once and inspect it' },
  { id: 'experiment', name: 'Experiment', hint: 'Scan one or two parameters and measure the response' },
  { id: 'fit', name: 'Fit to data', hint: 'Import measurements and fit the model\'s parameters to them' },
] as const;

/** The simulation workspace: model definition on the left, results on the right. */
export function SimLab() {
  const model = useSim((s) => s.model);
  const notice = useSim((s) => s.notice);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('run');

  // Display-only settings don't change the numbers, so they shouldn't trigger a re-run.
  const { states, params, derived, tEnd, dt, method, tol, stopWhen } = model;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useMemo(() => simulate(model), [states, params, derived, tEnd, dt, method, tol, stopWhen]);

  return (
    <div className="sim-layout">
      <Definition />
      <main className="sim-main">
        <div className="subtabs inline" role="tablist">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} title={v.hint} onClick={() => setView(v.id)}>{v.name}</button>
          ))}
        </div>
        {notice && <div className="notice" role="alert">{notice} <button className="link" onClick={() => useSim.setState({ notice: '' })}>Dismiss</button></div>}
        {run.error && <div className="notice" role="alert"><b>Model error.</b> {run.error}</div>}
        {view === 'run' ? <RunView model={model} run={run} /> : view === 'experiment' ? <ExperimentView model={model} run={run} /> : <FitView model={model} run={run} />}
      </main>
    </div>
  );
}
