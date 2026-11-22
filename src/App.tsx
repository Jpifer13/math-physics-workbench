import { useEffect } from 'react';
import { desktop } from './desktop';
import { activeKind, dirtyDocuments, loadOpened, newDocument, openDocument, saveAllDirty, saveDocument, undoRedo } from './documents';
import { FlowEditor } from './flow/FlowEditor';
import { useFlow } from './flow/store';
import { MathTools } from './mathtools/MathTools';
import { TABS, useNav, type TabId } from './nav';
import { SimLab } from './sim/SimLab';
import { useSim } from './sim/store';

const fileName = (p: string | null) => p?.split(/[\\/]/).pop();

export function App() {
  const tab = useNav((s) => s.tab);
  const setTab = useNav((s) => s.setTab);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  // Native menu commands and documents opened from the operating system.
  useEffect(() => {
    if (!desktop) return;
    const offMenu = desktop.onMenu((action) => {
      if (action.startsWith('tab:')) return setTab(action.slice(4) as TabId);
      if (action === 'new:sim') return newDocument('sim');
      if (action === 'new:flow') return newDocument('flow');
      if (action === 'undo' || action === 'redo') return undoRedo(action);
      if (action === 'open') return void openDocument();
      if (action === 'saveAllAndClose') return void saveAllDirty().then((ok) => ok && desktop?.closeWindow());
      // Save acts on the workspace in view; Math Tools has no document, so fall back to the simulation.
      const kind = activeKind() ?? 'sim';
      void saveDocument(kind, action === 'saveAs');
    });
    const offFile = desktop.onFileOpened(loadOpened);
    desktop.ready();
    return () => { offMenu(); offFile(); };
  }, [setTab]);

  // Keep the shell informed of unsaved work so closing the window can ask first.
  const simDirty = useSim((s) => s.dirty);
  const flowDirty = useFlow((s) => s.dirty);
  useEffect(() => {
    desktop?.setDirty(dirtyDocuments().map((d) => d.name));
  }, [simDirty, flowDirty]);

  // Window title follows the document in view, as in any document app.
  const simTitle = useSim((s) => `${s.dirty ? '• ' : ''}${fileName(s.filePath) ?? (s.model.name || 'Untitled simulation')}`);
  const flowTitle = useFlow((s) => `${s.dirty ? '• ' : ''}${fileName(s.filePath) ?? (s.name || 'Untitled flow')}`);
  const title = tab === 'sim' ? simTitle : tab === 'flow' ? flowTitle : 'Math Tools';
  useEffect(() => {
    document.title = `${title} — Physics Tooling`;
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
        {tab === 'sim' && <SimLab />}
        {tab === 'flow' && <FlowEditor />}
        {tab === 'math' && <MathTools />}
      </div>
    </div>
  );
}
