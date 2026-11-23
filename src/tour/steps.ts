/**
 * The walkthrough: what a newcomer is shown, in order. Each step may switch
 * to a workspace and a view, and points at one part of the window.
 */
import { APP_NAME } from '../core/brand';
import type { TabId } from '../nav';
import type { SimViewId } from '../sim/view';

export interface TourStep {
  title: string;
  body: string;
  /** Workspace to show for this step. */
  tab?: TabId;
  /** View of the Simulations workspace to show. */
  view?: SimViewId;
  /** CSS selector of what to highlight; the first that is found. None: the card is centred. */
  target?: string;
}

export const STEPS: TourStep[] = [
  {
    title: `Welcome to ${APP_NAME}`,
    body: 'This is a workbench for doing mathematics and physics on a computer: describe a system, watch it run, experiment on it, and check it against data. This two-minute tour shows where everything is. The app has opened on an example so there is something to look at.',
    tab: 'sim', view: 'run',
  },
  {
    title: 'Four workspaces',
    body: 'Simulations is the main one: differential equations you can run. Equation Flows builds a formula from blocks with units checked. Math Tools graphs functions and fields. Scratchpad lets you write maths by hand.',
    tab: 'sim', view: 'run', target: '.tabs',
  },
  {
    title: 'The model is on the left',
    body: 'Everything that defines the system lives in this panel: its variables, how fast each one changes, its parameters, and how to solve it. A new install starts with an example in it, a ball thrown through the air. Change anything and the results on the right update at once.',
    tab: 'sim', view: 'run', target: '.sim-side',
  },
  {
    title: 'Start something of your own',
    body: 'Name the simulation here. New gives a blank one, Open and Save read and write .physsim files, and the list below loads one of ten ready-made systems (a pendulum, an orbit, a circuit) to adapt.',
    tab: 'sim', view: 'run', target: '.def-top',
  },
  {
    title: 'The equations, as the solver sees them',
    body: 'Each variable has a starting value and a rate of change, typed as ordinary expressions below and typeset here so you can check them by eye. As you type, names are completed for you, and units are checked if you give them.',
    tab: 'sim', view: 'run', target: '.equations',
  },
  {
    title: 'Parameters you can turn',
    body: 'The numbers the model depends on. Drag a slider or type a value and the simulation runs again immediately. These are also what experiments scan and fits adjust.',
    tab: 'sim', view: 'run', target: '[data-section="parameters"]',
  },
  {
    title: 'Five things to do with a model',
    body: 'These tabs are the stages of working with a model: run it once, experiment across a range, see how uncertain the answer is, fit it to measurements, and take it to other software.',
    tab: 'sim', view: 'run', target: '.sim-main > .subtabs',
  },
  {
    title: 'Run: one simulation',
    body: 'Play, pause and scrub through the run here. Below are a picture of the motion, charts of every quantity, and a table of measurements. Check accuracy re-runs with tighter numerics so you know whether to trust the result.',
    tab: 'sim', view: 'run', target: '.runbar',
  },
  {
    title: 'Experiment: vary a parameter',
    body: 'Choose a parameter and a range, and what to measure on each run. You get a response curve, or a map if you vary two parameters: where is the range greatest, how does the period depend on length.',
    tab: 'sim', view: 'experiment', target: '.experiment > .card',
  },
  {
    title: 'Uncertainty: how sure is the answer?',
    body: 'Tick the parameters you do not know exactly and say how well you know them. The app varies them all together and shows the spread of the result, and which inputs are responsible for it.',
    tab: 'sim', view: 'uncertainty', target: '.experiment > .card',
  },
  {
    title: 'Fit to data: match measurements',
    body: 'Import a table of measurements, or make test data from the current run to try it. Tick the parameters to adjust and the app finds the values that fit best, with their uncertainties.',
    tab: 'sim', view: 'fit', target: '.experiment > .card',
  },
  {
    title: 'Other software: take it with you',
    body: 'Any model exports as a runnable script for Python, MATLAB or Octave, Mathematica or Julia. If one is installed, the app can run it there and compare the two answers as an independent check.',
    tab: 'sim', view: 'tools', target: '.sim-main .card',
  },
  {
    title: 'Equation Flows: building blocks',
    body: 'Drag blocks from this list onto the canvas: inputs, constants, operations. Wire them together and the result is worked out with its units, and a mismatch (adding a mass to a length) is flagged where it happens.',
    tab: 'flow', target: '.palette',
  },
  {
    title: 'The canvas and the equation',
    body: 'Blocks and the wires between them make up a formula; a new install shows E = mc². Select a block to edit it on the right. Underneath, the finished equation is typeset and charted against any input, and can be sent to a simulation.',
    tab: 'flow', target: '.canvas',
  },
  {
    title: 'Math Tools',
    body: 'Four quick tools that need no setup: graph functions and find their zeros and areas, plot surfaces in 3D, draw vector fields, and convert units or look up physical constants.',
    tab: 'math', target: '.tools > .subtabs',
  },
  {
    title: 'Scratchpad: write it by hand',
    body: 'Write mathematics as you would on paper, with a pen, a finger or the keyboard. End a line with “=” for its value, define variables, or write a differential equation and open it as a simulation.',
    tab: 'scratch', target: '.ink-page',
  },
  {
    title: 'That is the whole app',
    body: 'Each view shows a short tip the first time you open it. “Functions and syntax” under the equations lists everything you can type. To see this tour again, use Help ▸ Take the Tour, or the ? at the top right.',
    tab: 'sim', view: 'run',
  },
];
