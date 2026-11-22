import { parse, type MathNode } from 'mathjs';
import { symbolToLatex } from '../core/expr';

/**
 * Typeset a model expression. Every symbol goes through the same rule as the
 * left-hand sides (`symbolToLatex`), so a name looks identical wherever it
 * appears — mathjs alone would render `g` upright as a unit and `vx` as a
 * product of two letters.
 */
export function exprTex(expr: string): string {
  try {
    return parse(expr).toTex({
      parenthesis: 'auto',
      handler: (node: MathNode) => {
        const n = node as MathNode & { name?: string };
        if (n.type !== 'SymbolNode' || !n.name) return undefined;
        // Braces keep the symbol separate from whatever precedes it ("\\cdot" + "x" must not become "\\cdotx").
        return `{${n.name === 'pi' ? '\\pi' : symbolToLatex(n.name)}}`;
      },
    });
  } catch {
    return `\\text{${expr.replace(/[\\{}$&#^_%~]/g, ' ')}}`;
  }
}
