# Working with other software

Physics Tooling is open source and needs nothing else to run. If you already
have MATLAB, Mathematica, Python or Julia, it can also work alongside them.
Nothing proprietary is bundled, linked or required: the app only writes plain
scripts and, if you ask it to, runs them in a program you have installed.

Everything described here is in **Simulations → Other software**.

## 1. Export a model as code

Any simulation can be exported as a self-contained script that solves the same
equations and writes a CSV of the results:

| Target | Solver used | Needs | Checked how |
| --- | --- | --- | --- |
| Python | SciPy `solve_ivp` (`RK45`, or `Radau` for stiff models) | Python 3, NumPy, SciPy | Every template is run in SciPy by the test suite |
| MATLAB / Octave | `ode45` (or `ode23s` for stiff models) | MATLAB, or the free GNU Octave | Every template is run in GNU Octave by the test suite; MATLAB itself has not been tried |
| Mathematica | `NDSolve` with `WhenEvent` | Mathematica or the free Wolfram Engine | **Not run against a real installation** |
| Julia | DifferentialEquations.jl (`DP5`, or `Rosenbrock23`) | Julia with DifferentialEquations | **Not run against a real installation** |

Parameters, initial conditions, observables, the stop condition and discrete
events (with their state resets) are all carried across. Two things are not:

- **Fixed-step methods.** A model set to RK4 or Euler is exported with a tight
  adaptive solve, since the targets have no like-for-like equivalent.
- **Functions outside the common set.** Expressions may use arithmetic,
  comparisons, `and`/`or`/`not`, conditionals, and `sin cos tan asin acos atan
  atan2 sinh cosh tanh exp log log10 log2 sqrt cbrt abs sign floor ceil round
  min max pow mod`. A model using anything else still runs in the app but
  cannot be exported, and the export view says which expression is the
  obstacle.

Names that are reserved in a target are adjusted (`lambda` becomes `lambda_`
in Python; in Mathematica every name gets an `m` prefix because single capitals
such as `E` and `I` are built-in symbols).

The scripts are yours. The app's licence does not extend to them.

## 2. Run a model in another program and compare

If one of these programs is installed, **Run and compare** executes the script
in it and compares each quantity with the app's own result. That is an
independent check on a simulation — a different implementation, and for stiff
models a different algorithm, arriving at the same numbers.

The app looks for `python3`, `octave`, `matlab`, `wolframscript` and `julia` on
your `PATH`. If a program lives somewhere else, **Locate…** lets you point to
it; the choice is remembered. The result can also be shown as a dashed
reference on the Run charts.

What happens when you press the button:

1. The script is written to a new temporary folder.
2. The program is started directly, with a fixed argument list and that folder
   as its working directory. No shell is involved.
3. The CSV it writes is read back, and the folder is deleted.

Nothing is sent over the network, and no licence checks are performed or
bypassed — a program that needs a licence will ask for it in its usual way.

### Is it safe to run a model someone sent me?

Expressions in a model are never copied into a script as text. Each is parsed
and re-emitted piece by piece from a fixed list of operators and functions, and
every name must be one the model defines. A model file therefore cannot place
arbitrary code into the generated script; an expression that does not fit is
refused. This is covered by tests.

## 3. Data in and out

- **In:** measured data as CSV, TSV or whitespace-separated text (Fit to data).
- **Out:** any run, experiment or sweep as CSV at full double precision.
- **Equations:** copy as plain text or LaTeX from Equation Flows.

CSV is deliberately the common denominator: MATLAB (`readmatrix`), Mathematica
(`Import`), Python (`numpy.loadtxt`, pandas) and Julia (`CSV.jl`) all read it
directly.

## Adding another target

An integration is two small pieces:

1. **A generator** in `src/integrations/` — a function from a model to script
   text, built on `translate()` (which handles expressions safely) and
   `planOf()` (which reduces a model to what a generator needs). Register it in
   `src/integrations/index.ts`.
2. **An engine entry** in `electron/main.cjs` — the program's command names and
   the arguments used to run a script — if it should be runnable from the app.

Add a cross-check to `src/integrations/integrations.test.ts` so the target is
verified wherever its program is available; the test skips itself where it is
not.
