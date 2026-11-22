import { useMemo, useState } from 'react';
import { PALETTE, type PaletteItem } from './catalog';

export const DRAG_MIME = 'application/x-physics-node';

export function Palette({ onAdd }: { onAdd: (item: PaletteItem) => void }) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({ Trigonometry: true, Exponential: true });
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE;
    return PALETTE.map((g) => ({
      ...g,
      items: g.items.filter((i) => `${i.title} ${i.glyph} ${i.hint}`.toLowerCase().includes(q)),
    })).filter((g) => g.items.length);
  }, [query]);

  return (
    <aside className="palette">
      <div className="panel-title">Building blocks</div>
      <input
        className="search"
        type="search"
        placeholder="Search blocks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search building blocks"
      />
      <div className="palette-scroll">
        {groups.map((g) => {
          const open = query ? true : !closed[g.title];
          return (
            <section key={g.title}>
              <button className="palette-group" onClick={() => setClosed({ ...closed, [g.title]: open })} aria-expanded={open}>
                <span className={`chev${open ? ' open' : ''}`}>›</span>
                {g.title}
                <span className="count">{g.items.length}</span>
              </button>
              {open && (
                <div className="palette-items">
                  {g.items.map((item) => (
                    <button
                      key={item.key}
                      className={`palette-item tone-${g.tone}`}
                      draggable
                      title={`${item.hint}\nDrag onto the canvas, or click to add`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, item.key);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => onAdd(item)}
                    >
                      <span className="pnode-icon small">{item.glyph}</span>
                      <span className="palette-label">{item.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {!groups.length && <p className="muted pad">No blocks match “{query}”.</p>}
      </div>
    </aside>
  );
}

export const findPaletteItem = (key: string): PaletteItem | undefined =>
  PALETTE.flatMap((g) => g.items).find((i) => i.key === key);
