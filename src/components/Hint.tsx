import { readStored, storageKey } from '../core/brand';
import { create } from 'zustand';

const STORAGE = 'hints.v1';

function restore(): string[] {
  try {
    const v = JSON.parse(readStored(localStorage, STORAGE) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
const keep = (dismissed: string[]) => {
  try {
    localStorage.setItem(storageKey(STORAGE), JSON.stringify(dismissed));
  } catch {
    /* the tips simply come back next time */
  }
};

/** Which first-use tips have been dismissed, remembered between sessions. */
export const useHints = create<{ dismissed: string[]; dismiss: (id: string) => void; reset: () => void }>((set, get) => ({
  dismissed: restore(),
  dismiss: (id) => { const dismissed = [...get().dismissed, id]; keep(dismissed); set({ dismissed }); },
  reset: () => { keep([]); set({ dismissed: [] }); },
}));

/** A short explanation shown the first time a view is opened, until dismissed. */
export function Hint({ id, children }: { id: string; children: React.ReactNode }) {
  const dismissed = useHints((s) => s.dismissed.includes(id));
  const dismiss = useHints((s) => s.dismiss);
  if (dismissed) return null;
  return (
    <div className="hint" role="note">
      <span>{children}</span>
      <button className="link" onClick={() => dismiss(id)}>Got it</button>
    </div>
  );
}
