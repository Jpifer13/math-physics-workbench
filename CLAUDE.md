# Physics Tooling — working notes

A desktop virtual laboratory for physicists and mathematicians: define a
dynamical system, integrate it, run numerical experiments, fit it to data, and
export the results. Electron + React + TypeScript. Open source under
AGPL-3.0-or-later, copyright Pifer Labs LLC.

Read `README.md` for the feature tour, `docs/roadmap.md` for what to build next
and why, and `docs/integrations.md` for the bridges to other software.

## Commands

```bash
npm install          # also downloads the Electron binary
npm run dev          # desktop app with hot reload (Vite + Electron)
npm start            # production build, then launch it
npm test             # vitest; ~120 tests
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build into dist/
npm run dist:dir     # unpacked packaged app in release/ (fast packaging check)
npm run dist         # installer for the current OS
npm run dev:web      # UI only, in a browser — no file dialogs or external tools
```

Always run `npm run typecheck` as well as `npm test`: vitest does not
type-check, so a wrong call signature in a test passes silently.

Tests that execute exported scripts need `python3` with SciPy and/or GNU
Octave on the PATH. They skip themselves when those are missing, so a green
run on a machine without them has **not** verified the Python or MATLAB export.

## Layout

```
electron/main.cjs      Desktop shell: window, menu, file dialogs, disk access,
                       running external programs. The only code with Node access.
electron/preload.cjs   The bridge exposed to the UI as window.desktop.
src/desktop.ts         Typed view of that bridge (undefined in a browser).
src/core/              Engine. No React, no DOM. Everything here is unit-tested.
  ode.ts                 Model types; Euler, RK4, RK45, Rosenbrock23; events
  fastExpr.ts            Compiles expressions to closures (mathjs fallback)
  measure.ts             Measurements, parameter scans, CSV
  fit.ts                 Data import, least-squares fit, profiles, runs test
  trust.ts               Run comparison, accuracy report, expectations, provenance
  dimcheck.ts            Unit parsing and dimensional checking of models
  units.ts, qmath.ts     Dimensioned quantities (used by Equation Flows)
  graph.ts, formula.ts, expr.ts   Flow-graph evaluation and symbolic output
src/sim/               Simulations workspace (the main one)
  store.ts               zustand store for the open simulation
  Definition.tsx         Left panel: the model editor
  RunView / ExperimentView / FitView / ToolsView   The four views
  compute.ts, worker.ts  Web-worker pool for scans, fits and profiles
  models.ts              Templates
src/flow/              Equation Flows workspace (React Flow node editor)
src/mathtools/         Grapher, 3D surfaces, vector fields, units
src/integrations/      Code export: python.ts, matlab.ts, mathematica.ts, julia.ts
src/components/        Plot (SVG), Heatmap, Plot3D (three.js, lazy), Tex, …
src/documents.ts       New/Open/Save/undo for both document kinds
```

The rule that keeps this maintainable: **`src/core` knows nothing about the
UI.** New numerical behaviour goes there with tests; views only display it.

## Conventions

- **Document types.** `.physsim` is an `OdeModel` (see `core/ode.ts`);
  `.physflow` is a `FlowDoc`. Both are JSON with a `format` number
  (`src/version.ts`). If you change either shape, bump `FILE_FORMAT` and add a
  migration where files are loaded in `documents.ts`.
- **What re-runs a simulation.** `SimLab.tsx` memoises the run on the fields
  that affect the numbers (states, params, derived, events, solver settings).
  Add a new numeric field to that list and to `basisOf` in `ExperimentView.tsx`
  and `modelEssence` in `core/trust.ts`; display-only fields stay out.
- **Charts.** One y-axis per chart. Series colours come from the fixed
  `--series-1…8` order in `styles.css`; don't invent colours.
- **Plain-language errors.** Messages say what happened and what to do, in the
  user's terms. No raw exceptions in the UI.
- **Commits** go on a feature branch, not straight to `main`.

## Things that will bite you

- **No `eval`.** The packaged app runs under a strict Content-Security-Policy
  (injected in `vite.config.ts`). `new Function` and inline scripts fail in
  production while working in `npm run dev`. `fastExpr.ts` builds closures for
  this reason. Check anything dynamic with `npm start`, not just `dev`.
- **React Flow is v13.** Its change handlers receive a changeset object
  (`changes.applyTo(nodes)`), not the array API of v11/v12 that most examples
  show. Selection callbacks must be stable references or it loops.
- **Code generation must never copy expression text.** `integrations/translate.ts`
  re-emits expressions from the syntax tree against a whitelist; that is what
  stops a shared model file injecting code into a script that then gets run.
  Keep every new generator on `translate()`.
- **External programs** are started by `electron/main.cjs` with `execFile`
  (no shell) from a fixed table. Adding one means an entry there plus a
  generator; see "Adding another target" in `docs/integrations.md`.
- **Workers.** Scans, fits and profiles run in web workers and fall back to
  the main thread if a worker cannot start. Models are sent without their
  attached data (`lean()` in `compute.ts`).
- **Events.** A discrete event fires on a false→true crossing, located by
  bisection; resets are simultaneous. Events that accumulate without limit stop
  the run with a message — that is intended, not a bug to "fix" by letting the
  state pass through.
- **The save prompt blocks quitting.** With unsaved changes, closing the window
  shows a native Save / Don't Save / Cancel dialog. Automated runs must answer
  it or they hang.

## Verifying UI changes

Unit tests cover the engine, not the interface. For anything visible, launch
the built app and look at it. A scripted check works with Playwright's Electron
support:

```js
const { _electron } = require('playwright');
const app = await _electron.launch({
  executablePath: require('electron'),   // path to the Electron binary
  args: ['.', '--user-data-dir=/some/fresh/dir'],
});
const win = await app.firstWindow();
// Native dialogs cannot be clicked; stub them in the main process:
await app.evaluate(({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  dialog.showMessageBoxSync = () => 1;   // "Don't Save" on quit
}, '/tmp/out.physsim');
```

Use a fresh `--user-data-dir` each run: the app restores the last working copy
from local storage, which otherwise leaks state between runs. On a headless
Linux box add `--no-sandbox` and run under `xvfb-run`; WebGL there needs
`--use-angle=swiftshader --enable-unsafe-swiftshader`.

Several real defects in this project were only found by looking at screenshots
(malformed typeset equations, a playback cursor baked into exported figures),
so do look.

## State of the work

Done and verified: the three workspaces, four solvers with events, experiments
(1-D and 2-D), fitting with uncertainties and profiles, accuracy checks,
expectations, provenance, unit checking, undo/redo, code export, running in
external tools, the desktop shell, and Linux packaging.

**Not verified — treat as untested:**
- Mathematica and Julia export: generated, never run against a real install.
- MATLAB itself: the `.m` export is verified in GNU Octave only.
- macOS and Windows builds: only Linux packaging has been exercised.
- Code signing and notarisation: documented in the README, never run.
- The installer workflow (`docs/build-desktop.workflow.yml`): never run.
- The LaTeX summary: structurally tested, never compiled.
- 3D views on a real GPU (checked with software rendering only).

**Waiting on the owner:**
- Copy `docs/build-desktop.workflow.yml` to `.github/workflows/` to enable
  installer builds (it could not be pushed from the original environment).
- Signing certificates, if signed installers are wanted.
- Whether to add a contributor agreement before accepting outside contributions.

**Next, in roadmap order** (`docs/roadmap.md` has the evidence and detail):
1. Item 7 — uncertainty propagation and global (Sobol) sensitivity analysis.
   The largest remaining gap; the worker pool it needs already exists.
2. Rest of item 8 — bootstrap uncertainties; tying one fit parameter to another.
3. Rest of item 9 — image export for heat maps and 3D views; figure size and
   font control; PDF.
4. Items 10–12 — diff-friendly files and a compare view, sub-flows, in-app
   function reference, a command-line mode.

Known rough edges: `npm audit` reports a moderate advisory in the installer
build tool (dev-only; the automatic fix is a breaking downgrade); there is no
dark theme; simulation unit checking is dimensional only (a non-SI unit is
flagged, not converted).
