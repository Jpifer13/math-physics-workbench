/** A number field that tolerates half-typed input such as "1e" or "-". */
export function NumberField({ value, onChange, className, label }: { value: number; onChange: (v: number) => void; className?: string; label?: string }) {
  return (
    <input
      key={value}
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={label ?? 'Value'}
      defaultValue={String(value)}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v)) { if (v !== value) onChange(v); }
        else e.target.value = String(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

