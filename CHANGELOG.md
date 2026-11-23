# Changelog

Notable changes to Math & Physics Workbench (called Physics Tooling until
November 2026), newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Add an entry under **Unreleased** in the same branch as the change. Write it
for someone using the app: what they can now do, or what behaves differently.
A change to the `.physsim` or `.physflow` format (`FILE_FORMAT` in
`src/version.ts`) always gets an entry under **Changed**.

## [Unreleased]

### Added

- **A guided tour.** On first launch the app offers a short walk round: it
  lights up each part of the window in turn, switches workspaces and views
  for you, and explains what each is for. Take it again from Help ▸ Take the
  Tour, or the **?** at the top right.

### Fixed

- **Scratchpad: the Pencil writes when your palm lands first.** Resting your
  hand on the iPad before the nib touched meant the pen was ignored and only
  a finger would draw.
- **Scratchpad: lines stay the lines you wrote.** Two lines written close
  together, or beside a tall fraction elsewhere on the page, could be joined
  into one and re-read as nonsense, losing the values they had set. Limits
  written above and below an integral or sum sign now stay with it.
- **Scratchpad: numbers of more than one digit.** A handwritten √14 was read
  correctly and then worked out as 2, and 7/12 as 3.5, because the digits
  were multiplied together.
- **Scratchpad: more readings are understood.** `\rarr` and a few other
  spellings are accepted, and a handwritten integral whose sign was read as
  a sum is put right when its term ends in dx.

- **Scratchpad: an integral with no finite value says so.** The integral of
  x² from 0 to ∞ was given as about 1.3 × 10¹⁴, a meaningless number. It now
  reports that the integral does not settle on a value.

## [0.2.0] — 2026-11-22

The first release with installers, for Windows, macOS and Linux. They are
unsigned, so macOS and Windows warn on first launch. Only the macOS installer
has been run; see "State of the work" in `CLAUDE.md` for what is and is not
verified.

### Added

- Continuous integration: every push is type-checked, tested (with the
  Python and Octave export tests really run) and built. Installers for
  Windows, macOS and Linux build from the Actions tab or on a `v*` tag.
- **Scratchpad.** A fourth workspace for writing mathematics by hand. Lines
  are read, typeset and worked out: values, variables defined anywhere on the
  page, equations with one unknown, functions, definite integrals, sums and
  derivatives. Differential equations written on the page open as a
  simulation. Misread lines can be corrected by typing.
- **A build for tablets and browsers** (`npm run build:web`): a static site
  that can be added to an iPad's home screen and works offline when served
  over HTTPS. See `docs/tablet.md`.
- **A native iPad app** built from the same interface with Capacitor
  (`npm run build:ios`, then run from Xcode). It includes the handwriting
  model and works offline. Save and Export go through the share sheet.
- Handwriting is read on the device by an optional model
  (`npm run setup:handwriting`), or by a recognition service of your own
  choosing, which is off unless you turn it on and build with its address
  permitted.
- Buttons and fields are larger on touch screens.
- **Uncertainty view.** Give parameters a spread (normal or uniform) and
  sample them together on a seeded Latin hypercube. Shows the distribution of
  a measurement with 68% and 95% intervals, a band around the observable over
  time, and Sobol first-order and total sensitivity indices with intervals.
  The analysis is saved with the simulation and recorded in CSV exports.
- **Groups in equation flows.** Select several blocks and collapse them into
  one named block; duplicate it to reuse the calculation, ungroup to edit.
  Any block can now be duplicated from the inspector.
- **Command-line mode.** `run`, `experiment`, `uncertainty`, `check` and
  `template` work without the window, from a source checkout
  (`npm run -s cli -- …`, `make cli ARGS="…"`) or from the installed app's
  executable. `check` exits non-zero when an expectation fails.
- **Autocomplete in equation fields**: the model's names, then functions.
  Arrow keys choose, Tab or Enter accepts, Escape dismisses.
- **Functions and syntax reference**, searchable, with a worked example for
  every entry.
- **Model check**: lists likely mistakes that are not errors, such as an
  unused parameter, a misspelt name, or an event that can never fire.
- **First-use tips** on each simulation view, dismissible; they can be shown
  again from the reference.
- **Compare with a file.** File menu, or the link under Save: lists what
  differs between the open document and a saved one, and which differences
  change the numbers. A simulation's file can be shown as a reference run.
- **Tidy layout** arranges an equation flow left to right along its wires.
- **Figure export for every chart.** Heat maps and bar charts now save as
  SVG, PNG or PDF, and 3D views as PNG or PDF. Line charts gain PDF.
- **Figure size.** *Size…* on any chart sets the width and height on the page
  (mm) and the text size (pt) for all exported charts. The chart is laid out
  again at that size, so text comes out at the size asked.
- **Tied fit parameters.** In *Fit to data*, a parameter can follow an
  expression in the others (`k2 = 2 * k`) instead of being fitted or fixed.
  Its fitted value and uncertainty are reported with the rest.
- **Bootstrap uncertainties.** Resamples the data and refits 200 times in
  background threads, giving 68% and 95% intervals beside the linear estimate.
- The fit setup (free parameters, ties, bounds) survives switching views.
- Charts can draw shaded bands.
- A `Makefile` for running, checking and building from the command line;
  `make doctor` reports which optional external tools are installed.
- This changelog.

### Changed

- **The app is now called Math & Physics Workbench** (it was Physics Tooling).
  The package and repository are `math-physics-workbench` and the application
  id is `io.mathphysicsworkbench.app`. Nothing about your files changes:
  `.physsim` and `.physflow` keep their extensions and format, and files and
  exports written under the old name open and import as before. On first
  launch the app copies your window position, located programs and working
  copies from the old data folder, which it leaves in place.

- File format is now 4 (format 4 added group blocks to flows; format 3 the
  layout below). Files are laid out for version control: fixed key
  order, one item per line, and a flow's block positions in their own
  `layout` section. Format 2 added an optional `uncertainty` analysis to
  simulations. Files from formats 1 and 2 open unchanged; version 0.1.0
  refuses newer files rather than half-load them.

### Fixed

- `npm test` no longer also runs the tests of repository copies in
  subfolders (git worktrees).
- macOS: quitting with unsaved changes and answering the prompt now quits the
  app. Before, the window closed and the app stayed running.
- `package-lock.json` matches `package.json` again, so `npm install` no longer
  modifies it.

## [0.1.0] — 2026-11-22

The project as first recorded. It was never tagged, and no installer was
published for it.

### Simulations

- Model editor for systems of ODEs: state variables, initial conditions,
  rates, parameters, observables, events, solver settings and notes, with
  equations typeset from what the solver integrates.
- Four solvers: Euler, RK4, adaptive Dormand–Prince RK45, and Rosenbrock 2(3)
  for stiff systems. Each run reports steps, rejections, evaluations and wall
  time.
- Stop conditions and discrete events located inside the step by bisection;
  events apply simultaneous state resets and stop the run with a message if
  they accumulate without limit.
- Run view: measurements (final, min, max, mean, period), a held reference
  run for comparison, 2D and 3D trajectories, animated scene, CSV export.
- Templates: projectile, bouncing ball, pendulum, oscillator, orbit, Lorenz,
  charge in a magnetic field, Van der Pol, RLC, coupled oscillators.

### Experiments

- Scan one parameter and reduce each run to a measurement; plot the response
  curve, locate extrema, view the family of trajectories.
- Scan two parameters on a grid, shown as a heat map or 3D surface.
- Scans, fits and profiles run in a pool of web workers, with a main-thread
  fallback.

### Fitting

- Import measured data (several series, optional error bars) and fit chosen
  parameters by weighted least squares, with a range survey before local
  refinement and optional bounds.
- One-sigma uncertainties, correlation matrix, chi-squared per degree of
  freedom, and a warning when the data cannot separate parameters.
- Fit profiles: asymmetric intervals read off the profile curve, with second
  minima flagged.
- Runs test on residuals to warn when the model itself does not fit.

### Trusting a result

- *Check accuracy*: re-runs with tighter numerics and with a different
  method, reports how far each quantity moves, and charts step size over time.
- Expectations saved with the model and checked on every run.
- Failed runs name the variable that ran away or the rate that became
  undefined; solver advice is based on measured step counts.
- Dimensional checking of rates, initial values, observables, events and stop
  conditions wherever units are given.
- Provenance header on every CSV export, and a single-file run record.

### Equation Flows

- Node editor for composing equations from inputs, constants, operations and
  formula blocks, with SI dimensions carried through and mismatches caught.
- Flows typeset as LaTeX; any output charted against one or two swept inputs,
  in 2D or 3D.
- *Add to simulation* sends a composed formula across as an observable.

### Math tools

- Function grapher with calculus helpers, animated 3D surface plotter, vector
  field plotter, unit converter and constants table.

### Export and other software

- Runnable scripts for Python (SciPy), MATLAB/Octave, Mathematica and Julia,
  generated from the syntax tree rather than from expression text. Python and
  Octave output is checked against the app by the test suite; Mathematica and
  Julia output has never been run.
- Run a simulation in an installed external tool and compare the results.
- Line charts as standalone SVG or PNG; equations, parameter table and method
  description as LaTeX or Markdown.

### Desktop app

- Electron shell with native menus, file dialogs, `.physsim` and `.physflow`
  file associations, remembered window placement and a sandboxed bridge.
- New/Open/Save, undo/redo, working copy restored on launch, and a
  Save / Don't Save / Cancel prompt on closing with unsaved changes.
- Strict Content-Security-Policy in production builds.
- Packaging configuration for dmg, NSIS, AppImage and deb. Only the Linux
  targets have been built.

### Project

- Licensed under AGPL-3.0-or-later.
- Research-based roadmap in `docs/roadmap.md`.
