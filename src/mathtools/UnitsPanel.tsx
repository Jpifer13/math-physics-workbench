import { useState } from 'react';
import { baseUnitString, compatibleUnits, CONSTANTS, dimName, fmtNum, fromUnit, getUnit, toUnit } from '../core/units';
import { NumberField } from '../components/NumberField';
import { Tex } from '../components/Tex';
import { UnitSelect } from '../flow/PhysNode';

export function UnitsPanel() {
  const [value, setValue] = useState(1);
  const [unit, setUnit] = useState('eV');
  const u = getUnit(unit)!;
  const q = fromUnit(value, unit);
  const others = compatibleUnits(u.d).filter((o) => o.symbol !== unit);

  return (
    <div className="tool-layout single">
      <main className="tool-main">
        <section className="card">
          <h3>Unit converter</h3>
          <div className="converter">
            <NumberField className="code big" value={value} onChange={setValue} label="Value to convert" />
            <UnitSelect className="big" value={unit} onChange={setUnit} />
            <span className="muted">
              {u.name} · a {dimName(u.d)}{baseUnitString(u.d) ? ` · base units ${baseUnitString(u.d)}` : ''}
            </span>
          </div>
          {others.length ? (
            <table className="table">
              <thead><tr><th className="num">Value</th><th>Unit</th><th>Name</th></tr></thead>
              <tbody>
                {others.map((o) => (
                  <tr key={o.symbol}><td className="num">{fmtNum(toUnit(q, o.symbol), 7)}</td><td>{o.symbol || '—'}</td><td>{o.name}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No other units of this kind are defined.</p>}
        </section>
        <section className="card">
          <h3>Physical constants</h3>
          <table className="table">
            <thead><tr><th>Symbol</th><th>Name</th><th className="num">Value</th><th>Unit</th><th>Quantity</th></tr></thead>
            <tbody>
              {CONSTANTS.map((c) => (
                <tr key={c.id}>
                  <td><Tex tex={c.latex} /></td>
                  <td>{c.name}{c.note && <span className="muted"> — {c.note}</span>}</td>
                  <td className="num">{fmtNum(c.q.v, 10)}</td>
                  <td>{c.unit || '—'}</td>
                  <td className="muted">{dimName(c.q.d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
