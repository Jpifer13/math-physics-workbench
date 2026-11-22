# Changelog

Notable changes to Physics Tooling, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Add an entry under **Unreleased** in the same branch as the change. Write it
for someone using the app: what they can now do, or what behaves differently.
A change to the `.physsim` or `.physflow` format (`FILE_FORMAT` in
`src/version.ts`) always gets an entry under **Changed**.

## [Unreleased]

### Added

- **Uncertainty view.** Give parameters a spread (normal or uniform) and
  sample them together on a seeded Latin hypercube. Shows the distribution of
  a measurement with 68% and 95% intervals, a band around the observable over
  time, and Sobol first-order and total sensitivity indices with intervals.
  The analysis is saved with the simulation and recorded in CSV exports.
- Charts can draw shaded bands.
- This changelog.

### Changed

- `.physsim` file format is now 2: simulations can carry an `uncertainty`
  analysis. Format 1 files open unchanged; version 0.1.0 will refuse files
  saved from now on rather than silently drop the analysis.

### Fixed

- macOS: quitting with unsaved changes and answering the prompt now quits the
  app. Before, the window closed and the app stayed running.

- `package-lock.json` matches `package.json` again, so `npm install` no longer
  modifies it.

## [0.1.0] — 2026-11-22

First tagged state of the project. Nothing has been published as an installer
yet; see "State of the work" in `CLAUDE.md` for what is and is not verified.

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
