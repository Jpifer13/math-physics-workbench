# Roadmap: problems researchers have with comparable tools, and what to build

This list comes from a survey of what physicists, mathematicians and other
computational researchers report as pain points with similar software (MATLAB
and Simulink, Mathematica, Modelica tools, LabVIEW, fitting packages, and
home-grown simulation code). Each item states the problem, the evidence for it,
where Physics Tooling stands today, and a concrete proposal.

**On the evidence.** It is uneven. Some items rest on peer-reviewed surveys and
systematic reviews; others on vendor blogs, forum threads and commentary. Each
item says which. Nothing here is a survey of this app's own users — there are
none yet — so the ordering is a judgement, to be revised once real users weigh
in.

Size: **S** = days, **M** = one to two weeks, **L** = longer.

---

## Priority 1 — can I trust this result?

### 1. No way to tell whether a numerical answer is right

**Problem.** Research software is written to find answers nobody knows in
advance, so there is usually nothing to check the output against (the "oracle
problem"). Surveys of research-software developers describe testing as hard for
exactly this reason, and note that software faults have led to retracted
papers. A common shortcut — "energy is conserved, so the integration is
accurate" — is specifically called out as unreliable.
*Evidence: peer-reviewed surveys and a systematic review ([Eisty et al.][eisty],
[Kanewala & Bieman][kanewala]); a preprint on energy drift ([bioRxiv][drift]).*

**Status: done.** *Check accuracy* in the Run view re-runs the model with
tighter numerics and again with a different method, reports how far each
quantity moves, and says plainly whether the run has converged — or whether
the disagreement grows with time, as it does for chaotic systems. Conserved
quantities are covered by expectations (item 2), and the report states that
conservation alone does not prove accuracy. "Run and compare" adds a check
against an independent program.

### 2. Models have no tests

**Problem.** The same literature finds automated testing uncommon in scientific
code. A model that worked last month can be silently broken by an edit.
*Evidence: as item 1.*

**Status: done.** A model carries expectations ("period of r = 14.993 ±
0.0015", "peak-to-peak range of E ≤ 6.3e-8"). They are checked on every run
and shown as a pass/fail strip; clicking a value in the Measurements table
creates one. They are saved in the file and included in run records.

### 3. Solver failures are opaque

**Problem.** When a solver fails, tools report symptoms ("Newton iteration
failed to converge", minimum step size reached) and leave the diagnosis to the
user. A MathWorks engineer describes the manual root-cause process as tedious
and notes that many users are not comfortable with the debugger; a Modelica
paper says the abstraction level of equation-based models makes errors hard to
locate.
*Evidence: vendor engineering blog ([MathWorks][mw-constraint]) and a conference
paper ([Modelica debugging][modelica-debug]) — informative, not a survey.*

**Status: done.** A failed run names the variable that ran away or the rate
that became undefined. The accuracy check includes a step-size-over-time
chart, and recommends switching solver only when the other method measurably
reached the same answer in far fewer steps. (An earlier rule of thumb based on
step count alone was removed after it gave wrong advice on a relaxation
oscillator.)

### 4. Unit mistakes inside simulation equations go unnoticed

**Problem.** A study of scientific code found that reasoning about units is
done by hand, and that automatic checking has not been adopted despite many
proposed systems. The authors of a review of unit libraries note there is no
reliable estimate of how often unit errors occur and argue they are
under-reported. The Mars Climate Orbiter is the standard example.
*Evidence: peer-reviewed papers ([McKeever et al.][units-libs], [Orchard et
al.][units-practice]); frequency is explicitly unmeasured.*

**Status: done.** Units are parsed as people write them (`m/s²`,
`J/(mol·K)`, `1/s`). Wherever they are given, every rate, initial value,
observable, event and stop condition is checked, with a note beside the
offending equation ("the rate of change of v works out as force (N), but dv/dt
needs acceleration (m/s²)"). Unlabelled quantities are treated as unknown, so
the checking is as strict as the model is annotated. Units of unlabelled
observables are inferred. **Limit:** the check is dimensional only — equations
still use the numbers as typed, so a parameter entered in a non-SI unit is
flagged, not converted.

---

## Priority 2 — can someone else reproduce it?

### 5. Results cannot be traced back to what produced them

**Problem.** Reproducing a computational result needs the model, the exact
parameter values, the solver settings and the software version. Studies that
tried to reproduce published computational work report missing parameters and
unclear provenance as recurring barriers.
*Evidence: peer-reviewed surveys and case studies ([Ivie & Thain][ivie],
[AlNoamany & Borghi][alnoamany], [Krafczyk et al.][krafczyk]).*

**Status: done.** Every CSV export begins with a header recording the app
version, the model's name and fingerprint, solver settings, all parameter
values, the equations, and the experiment design where there is one; the
header is skipped on import, so files round-trip. Both file formats carry a
format version, and a file from a newer version is refused with an
explanation. *Run record* exports the model, result and provenance as one
file.

### 6. Work is locked into one tool

**Problem.** Researchers describe closed tools as an obstacle to reproducible
work, and cost and licence terms as a reason to avoid them — while also
pointing out that switching tools is never free.
*Evidence: commentary and forum discussion ([reproducible MATLAB][repro-matlab],
[The Scientist][scientist], [opensource.com][oss-research]) — anecdotal.*

**Status: done.** The project is licensed under AGPL-3.0-or-later. Any
simulation can be exported as a runnable script for Python (SciPy),
MATLAB/Octave, Mathematica or Julia, so a result can be reproduced without this
app; the Python and Octave paths are verified by the test suite, the other two
are not yet. See [Working with other software](integrations.md).

---

## Priority 3 — analysis people get wrong

### 7. Sensitivity analysis done one parameter at a time

**Problem.** A systematic review titled "Why so many published sensitivity
analyses are false" found that most published analyses vary one input at a
time, leaving most of the input space unexplored and missing interactions
between parameters.
*Evidence: peer-reviewed systematic review ([Saltelli et al.][saltelli]).*

**Today.** Experiments scan one parameter, or two on a grid. That is exactly
the practice the review criticises once a model has more than two uncertain
inputs.

**Proposal — global sensitivity and uncertainty propagation (L).**
- *Uncertainty propagation:* give parameters a distribution (± or a range),
  sample them together (Latin hypercube), and show the spread of each
  observable as a band on the time series and a histogram of each measurement.
- *Global sensitivity:* Sobol first-order and total indices (or Morris
  screening for a cheaper first look), reported as a ranked bar chart per
  measurement. The parallel worker pool already exists for this.

### 8. Fits that look fine and are not

**Problem.** Fitting guides and package maintainers warn about the same
failures: the optimiser stops in a local minimum set by a subjective starting
guess; correlation matrices are only reliable for linear models; uncertainties
larger than the parameter itself signal a poorly constrained fit.
*Evidence: lecture notes, package documentation and maintainer forum posts
([Cornell notes][cornell-fit], [lmfit group][lmfit-guess], [debugging bad
fits][nlsq]) — practitioner consensus rather than a survey.*

**Status: mostly done.** *Profile the fit* steps each parameter across a
range, re-fits the others at every value, and reads the one-sigma interval off
the resulting curve — asymmetric where the problem is, and flagged if a second
minimum appears. A runs test on the residuals warns when they are not randomly
scattered, i.e. when the model, not the parameters, is the problem.
**Still open:** bootstrap resampling, and tying one parameter to another
(holding one fixed is already possible by not ticking it).

---

## Priority 4 — time lost around the science

### 9. Getting figures and equations into a paper

**Problem.** A survey of researchers put the median time spent formatting a
manuscript — figures and tables included — at 14 hours per paper and 52 hours
per person per year. The figures are self-reported.
*Evidence: peer-reviewed survey ([LeBlanc et al., PLoS ONE][formatting]); it
does not separate out figure work.*

**Status: mostly done.** Line charts export as SVG (vector) or PNG (3×) from
buttons that appear on hover; the export is standalone, with a white
background and legend, and leaves out the playback cursor. *Copy as LaTeX /
Markdown* produces the equations, initial conditions, a parameter table and a
sentence describing the numerical method. **Still open:** exporting heat maps
and 3D views as images, PDF output, and choosing a figure's physical size and
font size.

### 10. Visual models that cannot be compared or do not scale

**Problem.** LabVIEW and Simulink models are binary files, so ordinary version
control cannot diff or merge them; the vendors' own tools are described by
users as weak, and by the vendors' documentation as sometimes requiring manual
resolution. Large diagrams are routinely broken up to stay manageable.
*Evidence: vendor documentation and user forums ([NI][ni-merge],
[MathWorks][mw-merge], [NI forum][ni-forum]) — anecdotal but consistent.*

**Today.** Both file formats are text (JSON), so version control already
works. But the files are not laid out for readable diffs, and a large flow has
no grouping or auto-layout.

**Proposal — diff-friendly files and structure for larger flows (M).**
- Write files with stable key order and one item per line, keeping layout
  (block positions) apart from meaning (blocks and wires), so a diff shows
  what changed scientifically.
- A built-in "compare with file…" view listing changed equations, parameters
  and settings between two versions.
- Sub-flows (collapse a group of blocks into one reusable block) and
  auto-layout.

### 11. Little time to learn a tool

**Problem.** Large surveys of research-software developers repeatedly report
too little time and training: researchers are under pressure to keep up with
their own field and have little left over for tooling.
*Evidence: peer-reviewed survey of 1,149 researchers ([Carver et al.][carver])
and the international RSE survey as cited in [Requirements Engineering for
Research Software][rse-vision].*

**Today.** Templates and worked examples give a starting point, and errors are
reported in plain language. There is no in-app help, no search across
functions, and nothing that explains a view the first time it is opened.

**Proposal — learn-by-doing aids (S–M).**
- A function and syntax reference searchable from the equation editors, with
  autocomplete for names defined in the model.
- A "check my model" pass that lists likely mistakes before running: unused
  parameters, states with zero rate, an event that can never fire.
- Short, dismissible explanations on first use of each view.

### 12. No way to drive it from a script

**Problem.** The same surveys describe software being rebuilt rather than
reused because existing tools are hard to plug into other work.
*Evidence: [Carver et al.][carver]; indirect.*

**Today.** Everything goes through the window. A parameter study too large for
the built-in experiment view has no route out.

**Proposal — headless runs (M).** A command-line mode that opens a `.physsim`,
runs it or its experiment, and writes CSV — so the app can sit inside a
pipeline, a cluster job or a notebook. The engine in `src/core` is already
free of UI code, which makes this mostly packaging.

---

## Suggested order for what remains

Done: items 1 to 6; items 8 and 9 mostly.

1. Item 7 — global sensitivity and uncertainty propagation. The one remaining
   place where the app still does what the research criticises.
2. The rest of items 8 and 9 — bootstrap and tied parameters; images of heat
   maps and 3D views, figure sizing.
3. Items 10, 11, 12 as the user base and model sizes grow.

## Sources

[eisty]: https://arxiv.org/abs/2501.17739
[kanewala]: https://ar5iv.arxiv.org/html/1804.01954
[drift]: https://www.biorxiv.org/content/10.1101/083055v1.full-text
[mw-constraint]: https://blogs.mathworks.com/simulink/2015/07/06/identifying-the-root-cause-of-an-algebraic-constraint-violation/
[modelica-debug]: https://www.academia.edu/43507433/Integrated_Debugging_of_Modelica_Models
[units-libs]: https://scitepress.org/Papers/2019/75247/pdf/index.html
[units-practice]: https://www.cl.cam.ac.uk/~mrd45/se4science19.pdf
[ivie]: https://www.doi.org/10.1145/3186266
[alnoamany]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7924683/
[krafczyk]: https://pmc.ncbi.nlm.nih.gov/articles/PMC8059663
[repro-matlab]: https://reproduciblematlab.github.io/blog/posts/2023-07-10-can-matlab-be-reproducible
[scientist]: https://www.the-scientist.com/the-costs-of-software-48557
[oss-research]: https://opensource.com/article/17/6/open-source-research
[saltelli]: https://arxiv.org/pdf/1711.11359
[cornell-fit]: https://collum.chem.cornell.edu/files/2019/10/Curve_Fitting_numerical_methods.pdf
[lmfit-guess]: https://groups.google.com/g/lmfit-py/c/rwGhl4Y86Ms
[nlsq]: https://nlsq.readthedocs.io/en/latest/howto/debug_bad_fits.html
[formatting]: https://pubmed.ncbi.nlm.nih.gov/31557272/
[ni-merge]: https://www.ni.com/docs/pl-PL/bundle/labview/page/merging-vis.html
[mw-merge]: https://blogs.mathworks.com/simulink/2025/06/30/merging-simulink-models-automatically-in-git/
[ni-forum]: https://forums.ni.com/t5/LabVIEW/Revision-Control-Best-Practices/m-p/4307576
[carver]: https://peerj.com/articles/cs-963
[rse-vision]: https://arxiv.org/pdf/2405.07781
