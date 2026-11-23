import { useMemo } from 'react';
import { Hint } from '../components/Hint';
import { simulate } from '../core/ode';
import { Definition } from './Definition';
import { ExperimentView } from './ExperimentView';
import { FitView } from './FitView';
import { ToolsView } from './ToolsView';
import { RunView } from './RunView';
import { UncertaintyView } from './UncertaintyView';
import { useSim } from './store';
import { SIM_VIEWS, useSimView, type SimViewId } from './view';

/** Shown the first time each view is opened, until dismissed. */
const TIPS: Record<SimViewId, string> = {
  run: 'This is one run of the model on the left; change anything there and it runs again at once. Click a value in the Measurements table to make it an expectation, and use Check accuracy before relying on a number.',
  experiment: 'An experiment repeats the run across a range of one parameter, or two, and plots one measured number per run. Use it to find where a response peaks or how it scales.',
  uncertainty: 'Tick the parameters you do not know exactly and give each a spread. They are all varied together, which gives the spread of a result and a ranking of which inputs cause it.',
  fit: 'Import measurements, pair each column with an observable, tick the parameters to adjust, and fit. Then check the uncertainties with Profile or Bootstrap.',
  tools: 'Export the model as a script for Python, MATLAB or Octave, Mathematica or Julia, or run it in one you have installed to check this app\'s answer independently.',
};

/** The simulation workspace: model definition on the left, results on the right. */
export function SimLab() {
  const model = useSim((s) => s.model);
  const notice = useSim((s) => s.notice);
  const view = useSimView((s) => s.view);
  const setView = useSimView((s) => s.setView);

  // Display-only settings don't change the numbers, so they shouldn't trigger a re-run.
  const { states, params, derived, tEnd, dt, method, tol, stopWhen, events } = model;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useMemo(() => simulate(model), [states, params, derived, tEnd, dt, method, tol, stopWhen, events]);

  return (
    <div className="sim-layout">
      <Definition run={run} />
      <main className="sim-main">
        <div className="subtabs inline" role="tablist">
          {SIM_VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? 'on' : ''} title={v.hint} onClick={() => setView(v.id)}>{v.name}</button>
          ))}
        </div>
        <Hint id={`view:${view}`}>{TIPS[view]}</Hint>
        {notice && <div className="notice" role="alert">{notice} <button className="link" onClick={() => useSim.setState({ notice: '' })}>Dismiss</button></div>}
        {run.error && <div className="notice" role="alert"><b>Model error.</b> {run.error}</div>}
        {view === 'run' ? <RunView model={model} run={run} /> : view === 'experiment' ? <ExperimentView model={model} run={run} /> : view === 'uncertainty' ? <UncertaintyView model={model} run={run} /> : view === 'fit' ? <FitView model={model} run={run} /> : <ToolsView model={model} run={run} />}
      </main>
    </div>
  );
}
