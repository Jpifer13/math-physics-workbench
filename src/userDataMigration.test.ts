import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The desktop shell is CommonJS (it runs in Electron's main process), so it is loaded as such.
const { migrateUserData, MARKER } = createRequire(import.meta.url)('../electron/migrate.cjs') as {
  migrateUserData: (userData: string, appData?: string) => { migrated: boolean; reason: string; from: string | null; copied: string[] };
  MARKER: string;
};

let appData: string;
const oldDir = () => join(appData, 'Physics Tooling');
const newDir = () => join(appData, 'Math & Physics Workbench');

/** A data folder as the app left it under its earlier name. */
function seedOld() {
  mkdirSync(join(oldDir(), 'Local Storage', 'leveldb'), { recursive: true });
  writeFileSync(join(oldDir(), 'window-state.json'), '{"x":40,"y":60,"width":1500,"height":950}');
  writeFileSync(join(oldDir(), 'engines.json'), '{"python":"/usr/bin/python3"}');
  writeFileSync(join(oldDir(), 'Local Storage', 'leveldb', '000003.log'), 'working copy of the open simulation');
  writeFileSync(join(oldDir(), 'Local Storage', 'leveldb', 'LOCK'), '');
  // Chromium's own caches are not worth carrying over.
  mkdirSync(join(oldDir(), 'GPUCache'), { recursive: true });
  writeFileSync(join(oldDir(), 'GPUCache', 'data_0'), 'cache');
}

beforeEach(() => { appData = mkdtempSync(join(tmpdir(), 'math-physics-workbench-migrate-')); });
afterEach(() => { rmSync(appData, { recursive: true, force: true }); });

describe('moving saved state after the rename', () => {
  it('copies the window position, located programs and stored documents on first launch', () => {
    seedOld();
    const r = migrateUserData(newDir());
    expect(r.migrated).toBe(true);
    expect(r.from).toBe(oldDir());
    expect(r.copied).toEqual(['window-state.json', 'engines.json', 'Local Storage']);
    expect(JSON.parse(readFileSync(join(newDir(), 'window-state.json'), 'utf8'))).toEqual({ x: 40, y: 60, width: 1500, height: 950 });
    expect(readFileSync(join(newDir(), 'engines.json'), 'utf8')).toContain('/usr/bin/python3');
    expect(readFileSync(join(newDir(), 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('working copy of the open simulation');
    // The storage lock and the caches stay behind.
    expect(existsSync(join(newDir(), 'Local Storage', 'leveldb', 'LOCK'))).toBe(false);
    expect(existsSync(join(newDir(), 'GPUCache'))).toBe(false);
    // The old folder is untouched, so going back to the old version still works.
    expect(existsSync(join(oldDir(), 'window-state.json'))).toBe(true);
    expect(existsSync(join(oldDir(), 'Local Storage', 'leveldb', 'LOCK'))).toBe(true);
  });

  it('runs once: later changes under the new name are never overwritten', () => {
    seedOld();
    migrateUserData(newDir());
    writeFileSync(join(newDir(), 'window-state.json'), '{"x":1}');
    const again = migrateUserData(newDir());
    expect(again).toMatchObject({ migrated: false, reason: 'already done' });
    expect(readFileSync(join(newDir(), 'window-state.json'), 'utf8')).toBe('{"x":1}');
  });

  it('leaves alone a new folder that is already in use', () => {
    seedOld();
    mkdirSync(newDir(), { recursive: true });
    writeFileSync(join(newDir(), 'window-state.json'), '{"x":7}');
    const r = migrateUserData(newDir());
    expect(r).toMatchObject({ migrated: false, reason: 'already in use' });
    expect(readFileSync(join(newDir(), 'window-state.json'), 'utf8')).toBe('{"x":7}');
    expect(existsSync(join(newDir(), 'engines.json'))).toBe(false);
  });

  it('does nothing on a fresh install, and remembers that it looked', () => {
    const r = migrateUserData(newDir());
    expect(r).toMatchObject({ migrated: false, reason: 'nothing to migrate', from: null });
    expect(existsSync(join(newDir(), MARKER))).toBe(true);
    // Installing the old version afterwards does not trigger a late migration.
    seedOld();
    expect(migrateUserData(newDir()).reason).toBe('already done');
  });

  it('copies what there is when only part of the old state exists', () => {
    mkdirSync(oldDir(), { recursive: true });
    writeFileSync(join(oldDir(), 'engines.json'), '{}');
    expect(migrateUserData(newDir())).toMatchObject({ migrated: true, copied: ['engines.json'] });
  });

  it('finds the folder used when the app ran unpackaged under its package name', () => {
    mkdirSync(join(appData, 'physics-tooling'), { recursive: true });
    writeFileSync(join(appData, 'physics-tooling', 'window-state.json'), '{"x":3}');
    const r = migrateUserData(newDir());
    expect(r.from).toBe(join(appData, 'physics-tooling'));
    expect(readFileSync(join(newDir(), 'window-state.json'), 'utf8')).toBe('{"x":3}');
  });

  it('reports a failure instead of throwing, so the app still starts', () => {
    seedOld();
    // A file where the new folder should be makes every write fail.
    writeFileSync(newDir(), 'in the way');
    const r = migrateUserData(newDir());
    expect(r.migrated).toBe(false);
    expect(r.reason).toMatch(/^failed: /);
  });
});
