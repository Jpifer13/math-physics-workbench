/**
 * Integrations with other scientific software. Each target turns a model into
 * a self-contained script; some can also be run from the app if the user has
 * the program installed. Adding a target means adding one generator here and,
 * to make it runnable, one entry in the engine table in electron/main.cjs.
 */
import type { OdeModel } from '../core/ode';
import { generateJulia } from './julia';
import { generateMathematica } from './mathematica';
import { generateMatlab } from './matlab';
import { generatePython } from './python';

export { ExportError } from './translate';

export interface Target {
  id: 'python' | 'matlab' | 'mathematica' | 'julia';
  name: string;
  /** File extension of the script. */
  ext: 'py' | 'm' | 'wl' | 'jl';
  generate: (model: OdeModel) => string;
  /** Programs that can run this target's scripts (ids in the desktop shell's engine table). */
  engines: string[];
  /** What the user needs installed, in a sentence. */
  requires: string;
  /** How this target's scripts are checked against this app's own solver in the test suite, if they are. */
  checked: string | null;
}

export const TARGETS: Target[] = [
  { id: 'python', name: 'Python (SciPy)', ext: 'py', generate: generatePython, engines: ['python'], requires: 'Python 3 with NumPy and SciPy', checked: 'by running every template in SciPy' },
  { id: 'matlab', name: 'MATLAB / Octave', ext: 'm', generate: generateMatlab, engines: ['matlab', 'octave'], requires: 'MATLAB, or the free GNU Octave', checked: 'by running every template in GNU Octave (MATLAB itself has not been tried)' },
  { id: 'mathematica', name: 'Mathematica', ext: 'wl', generate: generateMathematica, engines: ['mathematica'], requires: 'Mathematica or the free Wolfram Engine, with wolframscript', checked: null },
  { id: 'julia', name: 'Julia', ext: 'jl', generate: generateJulia, engines: ['julia'], requires: 'Julia with the DifferentialEquations package', checked: null },
];
