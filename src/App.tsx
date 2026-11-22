import { useEffect, useState } from 'react';
import { desktop } from './desktop';
import { loadOpened, newFlow, openFlow, saveFlow } from './flow/files';
import { FlowEditor } from './flow/FlowEditor';
import { useFlow } from './flow/store';
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

  // Native menu commands and files opened from the operating system.
  useEffect(() => {
    if (!desktop) return;
    const offMenu = desktop.onMenu((action) => {
      if (action.startsWith('tab:')) return setTab(action.slice(4) as TabId);
      setTab('flow');
      if (action === 'new') newFlow();
      else if (action === 'open') void openFlow();
      else if (action === 'save') void saveFlow();
      else if (action === 'saveAs') void saveFlow(true);
    });
    const offFile = desktop.onFileOpened((file) => {
      setTab('flow');
      loadOpened(file);
    });
    desktop.ready();
    return () => { offMenu(); offFile(); };
  }, []);

  // Window title follows the open flow, as in any document app.
  const title = useFlow((s) => `${s.dirty ? '• ' : ''}${s.filePath?.split(/[\\/]/).pop() ?? (s.name || 'Untitled flow')} — Physics Tooling`);
  useEffect(() => {
    document.title = title;
  }, [title]);

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
