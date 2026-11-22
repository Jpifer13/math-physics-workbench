import { useEffect, useState } from 'react';
import { FlowEditor } from './flow/FlowEditor';
import { MathTools } from './mathtools/MathTools';
import { SimLab } from './sim/SimLab';

const TABS = [
  { id: 'flow', name: 'Flow Builder', hint: 'Wire blocks into equations' },
  { id: 'sim', name: 'Simulation Lab', hint: 'Watch systems evolve in time' },
  { id: 'math', name: 'Math Tools', hint: 'Graphs, fields, units' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>(() => {
    const h = location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? (h as TabId) : 'flow';
  });
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">∑</span> Physics Tooling</div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} title={t.hint}>{t.name}</button>
          ))}
        </nav>
      </header>
      <div className="workspace">
        {tab === 'flow' && <FlowEditor />}
        {tab === 'sim' && <SimLab />}
        {tab === 'math' && <MathTools />}
      </div>
    </div>
  );
}
