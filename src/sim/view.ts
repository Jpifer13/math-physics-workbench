import { create } from 'zustand';

export const SIM_VIEWS = [
  { id: 'run', name: 'Run', hint: 'Integrate the system once and inspect it' },
  { id: 'experiment', name: 'Experiment', hint: 'Scan one or two parameters and measure the response' },
  { id: 'uncertainty', name: 'Uncertainty', hint: 'Give parameters a spread, then see how much a result varies and which inputs drive it' },
  { id: 'fit', name: 'Fit to data', hint: 'Import measurements and fit the model\'s parameters to them' },
  { id: 'tools', name: 'Other software', hint: 'Export the model as code, or run it in MATLAB, Python, Mathematica or Julia and compare' },
] as const;
export type SimViewId = (typeof SIM_VIEWS)[number]['id'];

/** Which view of the Simulations workspace is showing. A store, so the walkthrough can switch it. */
export const useSimView = create<{ view: SimViewId; setView: (view: SimViewId) => void }>((set) => ({
  view: 'run',
  setView: (view) => set({ view }),
}));
