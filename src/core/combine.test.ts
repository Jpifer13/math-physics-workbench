import { describe, expect, it } from 'vitest';
import { combineReadings, namesIn, textToLatex } from './combine';
import { evaluateNotebook } from './scratch';

const squash = (s: string) => s.replace(/\s+/g, '');
const combined = (model: string, text: string, known: string[] = []) => squash(combineReadings(model, text, new Set(known)).latex);

describe('plain text from a text recogniser', () => {
  it('becomes LaTeX', () => {
    expect(textToLatex('x²+3x+2=')).toBe('x^{2}+3x+2=');
    expect(textToLatex('x²+3_x+2=')).toBe('x^{2}+3x+2=');
    expect(textToLatex('√14')).toBe('\\sqrt{14}');
    expect(textToLatex('7/12')).toBe('\\frac{7}{12}');
    expect(squash(textToLatex('θ = 2π'))).toBe('\\theta=2\\pi');
    expect(textToLatex('x=4\ny=7')).toBe('x=4 y=7');
    expect(textToLatex('e⁻²')).toBe('e^{-2}');
  });
});

// Every pair below is what the two recognisers actually said about a line written on an iPad.
describe('two readings of a handwritten line', () => {
  it('agree, and nothing changes', () => {
    expect(combineReadings('x = 4', 'x=4')).toEqual({ latex: 'x = 4' });
    expect(combineReadings('x + y =', 'x+y=')).toEqual({ latex: 'x + y =' });
    expect(combineReadings('\\sqrt { 1 4 }', '√14')).toEqual({ latex: '\\sqrt { 1 4 }' });
  });

  it('takes digits from the text reading: the 2 the model keeps misreading', () => {
    // Written: θ = 2. The model got the θ and not the 2; the text recogniser the other way round.
    expect(combined('\\theta = \\alpha', 'O=2')).toBe('\\theta=2');
    // Written: 7 over 12.
    expect(combined('\\frac { 2 } { 1 2 }', '7/12')).toBe('\\frac{7}{12}');
    // Written: x² + 3x + 2 =
    expect(combined('x ^ { 2 } + 3 x + 3 c', 'x²+3_x+2=')).toBe('x^{2}+3x+2=');
    // An exponent read as a curly d, which is not mathematics on its own: the text reading stands in.
    expect(combined('x ^ { \\partial }', 'x²')).toBe('x^{2}');
    expect(combined('x ^ { \\alpha } + 1', 'x²+1')).toBe('x^{2}+1');
  });

  it('keeps Greek letters and layout from the model', () => {
    // Written: sin(Δx). The text recogniser has no Greek to speak of.
    expect(combined('\\sin ( \\Delta X )', 'sin(wx)')).toBe('\\sin(\\DeltaX)');
    expect(combined('\\frac { a } { b }', 'a/b')).toBe('\\frac{a}{b}');
  });

  it('does not give up a name the page already uses for a digit', () => {
    expect(combined('z = 3', '2=3', ['z'])).toBe('z=3');
    expect(combined('z = 3', '2=3')).toBe('2=3');
    expect([...namesIn(['z = 4', '\\theta + x_1'])].sort()).toEqual(['theta', 'x', 'z']);
  });

  it('ignores a text reading that is about something else entirely', () => {
    // Written: a sum with limits. The text recogniser made nonsense of the layout.
    const model = '\\sum _ { z } ^ { x \\to \\alpha } x ^ { 2 }';
    expect(combineReadings(model, 'e^(xx^-)²').latex).toBe(model);
    expect(combineReadings('\\frac { 2 } { 1 2 }', 'Z').latex).toBe('\\frac { 2 } { 1 2 }');
  });

  it('restores an "=" the model dropped from the end', () => {
    expect(combined('x + y', 'x+y=')).toBe('x+y=');
    expect(combined('y = x + 1', 'y=x+1')).toBe('y=x+1');
  });

  it('falls back on the text reading when the model\'s cannot be read as mathematics', () => {
    expect(combineReadings('\\frac { 1 } {', 'x+1=').latex).toBe('x+1=');
  });

  it('offers the reading it did not choose', () => {
    expect(combineReadings('\\theta = \\alpha', 'O=2').other).toBe('\\theta = \\alpha');
    expect(combineReadings('\\sin ( \\Delta X )', 'sin(wx)').other).toBe('sin(wx)');
    expect(combineReadings('x = 4', 'x=4').other).toBeUndefined();
  });

  it('copes with one reading missing', () => {
    expect(combineReadings('x = 4', '')).toEqual({ latex: 'x = 4' });
    expect(combineReadings('', 'x=4')).toEqual({ latex: 'x=4' });
  });

  it('gives a page that works out', () => {
    const lines = [
      combineReadings('x ^ { 2 } + 3 x + 3 c', 'x²+3_x+2=').latex,
    ];
    const page = evaluateNotebook(['x = 4', ...lines]);
    expect(page.lines.at(-1)!.value).toBe(30);
  });
});
