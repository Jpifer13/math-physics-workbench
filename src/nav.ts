import { create } from 'zustand';

export const TABS = [
  { id: 'sim', name: 'Simulations', hint: 'Define a system, run it, and experiment on it' },
  { id: 'flow', name: 'Equation Flows', hint: 'Compose formulas from blocks with units checked' },
  { id: 'math', name: 'Math Tools', hint: 'Function analysis, surfaces, vector fields, units' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

const initial = (): TabId => {
  const h = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  return TABS.some((t) => t.id === h) ? (h as TabId) : 'sim';
};

/** Which workspace is showing. A store (not component state) so file commands can switch to it. */
export const useNav = create<{ tab: TabId; setTab: (tab: TabId) => void }>((set) => ({
  tab: initial(),
  setTab: (tab) => set({ tab }),
}));
