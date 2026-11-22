import { useRef, useState } from 'react';
import { applyCompletion, completions, type Completion, type CompletionSet, type ModelName } from '../core/reference';

/**
 * A text field for an equation that offers to finish the name being typed:
 * the model's own names first, then functions and constants. Arrow keys
 * choose, Tab or Enter accepts, Escape dismisses; typing on ignores it.
 */
export function ExprInput({ value, onChange, names, label, placeholder }: {
  value: string; onChange: (text: string) => void; names: ModelName[]; label: string; placeholder?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<CompletionSet | null>(null);
  const [index, setIndex] = useState(0);

  const offer = (text: string, caret: number | null) => {
    setMenu(caret === null ? null : completions(text, caret, names));
    setIndex(0);
  };
  const accept = (option: Completion) => {
    if (!menu) return;
    const next = applyCompletion(value, menu, option);
    onChange(next.text);
    setMenu(null);
    // The caret can only be placed once the new text is in the field.
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); });
  };

  return (
    <span className="expr-input">
      <input
        ref={input} className="code" value={value} placeholder={placeholder} aria-label={label} spellCheck={false} autoComplete="off"
        role="combobox" aria-expanded={!!menu} aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); offer(e.target.value, e.target.selectionStart); }}
        onBlur={() => setMenu(null)}
        onKeyDown={(e) => {
          if (!menu) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((index + (e.key === 'ArrowDown' ? 1 : menu.options.length - 1)) % menu.options.length);
          } else if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            accept(menu.options[index]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setMenu(null);
          }
        }}
      />
      {menu && (
        <ul className="expr-menu" role="listbox">
          {menu.options.map((o, i) => (
            // mousedown, not click: the field must not lose focus (and close the list) first.
            <li key={o.label} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(o); }} onMouseEnter={() => setIndex(i)}>
              <code>{o.label}</code><span>{o.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
