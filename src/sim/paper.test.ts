import { describe, expect, it } from 'vitest';
import { MODELS } from './models';
import { paperSummary } from './paper';

describe('paper summary', () => {
  const ball = MODELS.find((m) => m.id === 'bounce')!;
  it('writes LaTeX with equations, initial conditions, events, parameters and method', () => {
    const tex = paperSummary(ball, 'latex');
    expect(tex).toContain('\\begin{align}');
    // A symbol is typeset the same way on both sides of an equation.
    expect(tex).toContain('\\frac{\\mathrm{d}\\mathrm{vy}}{\\mathrm{d}t} &= -{g}');
    expect(tex).toContain('\\frac{\\mathrm{d}y}{\\mathrm{d}t} &= {\\mathrm{vy}}');
    expect(tex).toContain('y(0) = {h_{0}}');
    expect(tex).toContain('becomes true, the state is reset according to');
    expect(tex).toContain('$g$ & Gravity & $9.81\\,\\mathrm{m/s^{2}}$');
    expect(tex).toContain('Dormand--Prince Runge--Kutta 5(4) method with relative tolerance 1e-8');
    // Balanced environments, so it compiles as pasted.
    for (const env of ['align', 'table', 'tabular']) expect(tex.split(`\\begin{${env}}`).length).toBe(tex.split(`\\end{${env}}`).length);
  });
  it('never runs a command into the symbol that follows it', () => {
    // "\\cdotx" is not a LaTeX command: every control word in the output must be a real one.
    const known = new Set(['frac', 'dfrac', 'mathrm', 'cdot', 'left', 'right', 'sqrt', 'sin', 'cos', 'tan', 'exp', 'ln', 'log', 'pi', 'theta',
      'omega', 'sigma', 'rho', 'beta', 'mu', 'lambda', 'begin', 'end', 'hline', 'centering', 'caption', 'quad', 'to', 'circ', 'Omega', 'text']);
    for (const m of MODELS) {
      const words = paperSummary(m, 'latex').match(/\\[A-Za-z]+/g) ?? [];
      expect(words.filter((w) => !known.has(w.slice(1))), m.id).toEqual([]);
    }
  });
  it('writes Markdown for every template', () => {
    for (const m of MODELS) {
      const md = paperSummary(m, 'markdown');
      expect(md).toContain(`### ${m.name}`);
      expect(md).toContain('| Symbol | Description | Value |');
    }
  });
});
