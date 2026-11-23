/**
 * Light and dark appearance. The choice is "follow the system" unless the user
 * picks one. It is applied as `data-theme` on the document, which the
 * stylesheet's colour variables follow; anything drawn by script (canvases,
 * 3-D scenes) reads those variables and redraws when `useTheme` changes.
 */
import { create } from 'zustand';
import { readStored, storageKey } from './core/brand';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const STORAGE = 'theme.v1';
export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];
export const THEME_NAMES: Record<ThemeChoice, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

/** The appearance to show for a choice, given what the system prefers. */
export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): Theme => (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice);
/** The choice after this one, for a control that steps through them. */
export const nextChoice = (choice: ThemeChoice): ThemeChoice => THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];

const systemQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function stored(): ThemeChoice {
  try {
    const raw = readStored(localStorage, STORAGE);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* follow the system */
  }
  return 'system';
}

interface ThemeState {
  choice: ThemeChoice;
  /** What is showing now. */
  theme: Theme;
  choose: (choice: ThemeChoice) => void;
}

const show = (theme: Theme) => {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
};

export const useTheme = create<ThemeState>((set) => {
  const choice = typeof localStorage === 'undefined' ? 'system' : stored();
  const theme = resolveTheme(choice, !!systemQuery?.matches);
  show(theme);
  return {
    choice,
    theme,
    choose: (next) => {
      try { localStorage.setItem(storageKey(STORAGE), next); } catch { /* the choice simply is not remembered */ }
      const resolved = resolveTheme(next, !!systemQuery?.matches);
      show(resolved);
      // The desktop shell's own parts (title bar, menus, dialogs) follow the same choice.
      (window as { desktop?: { setTheme?: (c: ThemeChoice) => void } }).desktop?.setTheme?.(next);
      set({ choice: next, theme: resolved });
    },
  };
});

systemQuery?.addEventListener('change', (e) => {
  const { choice } = useTheme.getState();
  if (choice !== 'system') return;
  const theme = resolveTheme(choice, e.matches);
  show(theme);
  useTheme.setState({ theme });
});
if (typeof window !== 'undefined') (window as { desktop?: { setTheme?: (c: ThemeChoice) => void } }).desktop?.setTheme?.(useTheme.getState().choice);

/**
 * Show the light appearance until the returned function is called. A figure
 * saved to a file is always the light one, on white, whatever is on screen.
 * Meant to be undone before the browser next paints.
 */
export function forceLight(): () => void {
  const root = document.documentElement;
  const before = root.dataset.theme;
  root.dataset.theme = 'light';
  return () => { if (before === undefined) delete root.dataset.theme; else root.dataset.theme = before; };
}

/** A colour variable of the stylesheet, as it stands now. */
export const cssColor = (name: string, fallback = ''): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
