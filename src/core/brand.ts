/**
 * The program's name, in one place, and what it was called before.
 *
 * The app was renamed from "Physics Tooling". Files it wrote under that name
 * are still in people's hands: exports carry it in their headers, and saved
 * settings sit under its keys. Everything here that mentions the old name
 * exists so that those keep working.
 */

export const APP_NAME = 'Math & Physics Workbench';
/** For places too tight for the full name. */
export const APP_SHORT_NAME = 'Workbench';
/** Lower-case form for file names, storage keys and identifiers. */
export const APP_SLUG = 'math-physics-workbench';

/** Names earlier versions wrote into the files they exported. */
export const LEGACY_APP_NAMES = ['Physics Tooling'] as const;
const LEGACY_SLUGS = ['physics-tooling'] as const;

/** The marker a run-record file carries to say what it is. */
export const RUN_RECORD_KIND = `${APP_SLUG}-run-record`;
/** True for a run record written by this version or an earlier one. */
export const isRunRecordKind = (kind: unknown): boolean =>
  typeof kind === 'string' && [APP_SLUG, ...LEGACY_SLUGS].some((slug) => kind === `${slug}-run-record`);

/** First line of the provenance header of an export. */
export const provenanceTitle = (appVersion: string, when: string) => `${APP_NAME} ${appVersion} — exported ${when}`;

/**
 * Read the first line of a provenance header, whichever name the app had
 * when it wrote it. Null if the line is not one of ours.
 */
export function readProvenanceTitle(line: string): { app: string; version: string; when: string } | null {
  const text = line.replace(/^#\s?/, '').trim();
  for (const app of [APP_NAME, ...LEGACY_APP_NAMES]) {
    if (!text.startsWith(`${app} `)) continue;
    const m = /^(\S+) — exported (.+)$/.exec(text.slice(app.length + 1));
    if (m) return { app, version: m[1], when: m[2] };
  }
  return null;
}

/** A key for settings kept in the browser's storage, e.g. storageKey('sim.v1'). */
export const storageKey = (name: string) => `${APP_SLUG}.${name}`;

/** The slice of the Storage interface this needs; injected so it can be tested. */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void }

/**
 * Read a stored setting, finding it under the app's earlier name if it has
 * not been written under the current one yet, and moving it across so the
 * old key is read only once.
 */
export function readStored(store: KeyValueStore, name: string): string | null {
  const current = store.getItem(storageKey(name));
  if (current !== null) return current;
  for (const slug of LEGACY_SLUGS) {
    const old = store.getItem(`${slug}.${name}`);
    if (old === null) continue;
    store.setItem(storageKey(name), old);
    store.removeItem?.(`${slug}.${name}`);
    return old;
  }
  return null;
}
