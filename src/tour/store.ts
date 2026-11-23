import { create } from 'zustand';
import { readStored, storageKey } from '../core/brand';
import { desktop } from '../desktop';
import { STEPS } from './steps';

const SEEN = 'tour.v1';

const seen = (): boolean => {
  try {
    return readStored(localStorage, SEEN) !== null;
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    localStorage.setItem(storageKey(SEEN), 'seen');
  } catch {
    /* it is simply offered again next time */
  }
};

interface TourState {
  /** The step on show, or null when the walkthrough is closed. */
  step: number | null;
  start: () => void;
  next: () => void;
  back: () => void;
  /** Close it, whether finished or skipped; it is not offered again unless asked for. */
  close: () => void;
}

/**
 * The walkthrough opens by itself the first time the app is used, and never
 * again after that; it can always be started from the Help menu or the ?.
 * Automated runs pass --skip-tour so it does not sit in front of them.
 */
export const useTour = create<TourState>((set, get) => ({
  step: !seen() && !desktop?.skipTour ? 0 : null,
  start: () => set({ step: 0 }),
  next: () => {
    const step = get().step;
    if (step === null) return;
    if (step >= STEPS.length - 1) return get().close();
    set({ step: step + 1 });
  },
  back: () => {
    const step = get().step;
    if (step !== null && step > 0) set({ step: step - 1 });
  },
  close: () => {
    remember();
    set({ step: null });
  },
}));
