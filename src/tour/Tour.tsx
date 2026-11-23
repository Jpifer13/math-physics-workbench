import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNav } from '../nav';
import { useSimView } from '../sim/view';
import { placeCard, spotlight, type Box } from './place';
import { STEPS } from './steps';
import { useTour } from './store';

const same = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** The guided walkthrough: a spotlight on one part of the window and a card explaining it. */
export function Tour() {
  const index = useTour((s) => s.step);
  const { next, back, close } = useTour.getState();
  const step = index === null ? null : STEPS[index];
  const card = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Show the workspace and view the step is about.
  useEffect(() => {
    if (!step) return;
    if (step.tab && useNav.getState().tab !== step.tab) useNav.getState().setTab(step.tab);
    if (step.view && useSimView.getState().view !== step.view) useSimView.getState().setView(step.view);
  }, [step]);

  // Find what the step points at. It may not exist yet (a view still loading) or may move
  // (a chart resizing, the window being resized), so keep looking while the step is open.
  useEffect(() => {
    if (!step) return;
    let scrolled = false;
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      if (!el) return setTarget((old) => (old === null ? old : null));
      if (!scrolled) { scrolled = true; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      const r = el.getBoundingClientRect();
      const box = spotlight({ left: r.left, top: r.top, width: r.width, height: r.height }, { width: innerWidth, height: innerHeight });
      setTarget((old) => (same(old, box) ? old : box));
    };
    setTarget(null);
    measure();
    const timer = setInterval(measure, 200);
    window.addEventListener('resize', measure);
    return () => { clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [step]);

  // Put the card beside the target once its own size is known.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !step) return;
    const p = placeCard(target, { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight });
    setAt((old) => (old && old.left === p.left && old.top === p.top ? old : { left: p.left, top: p.top }));
  }, [step, target]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, next, back, close]);

  if (!step || index === null) return null;
  const first = index === 0;
  const last = index === STEPS.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour, step ${index + 1} of ${STEPS.length}: ${step.title}`}>
      {/* Dims everything but the target and keeps clicks off the app until the tour moves on. */}
      <div className="tour-shade" style={target ? { left: target.left, top: target.top, width: target.width, height: target.height } : { left: '50%', top: '50%', width: 0, height: 0 }} />
      <div ref={card} className="tour-card" style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <span className="tour-count">{first ? `${STEPS.length - 1} short steps` : `${index} of ${STEPS.length - 1}`}</span>
          <span className="spacer" />
          {!last && <button className="btn small" onClick={close}>{first ? 'Not now' : 'Skip'}</button>}
          {!first && <button className="btn small" onClick={back}>Back</button>}
          <button className="btn small primary" autoFocus onClick={next}>{first ? 'Show me round' : last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
