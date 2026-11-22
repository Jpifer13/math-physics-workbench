/**
 * One-time move of saved state after the app was renamed.
 *
 * Electron keeps an app's data in a folder named after the app, so renaming
 * "Physics Tooling" to "Math & Physics Workbench" pointed it at a new, empty
 * folder. On the first launch under the new name this copies across what the
 * user would miss: where the window was, which external programs they
 * located, and the browser storage holding the working copies of their
 * documents and their settings. The old folder is left as it was.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Folder names earlier versions used, newest first. */
const LEGACY_NAMES = ['Physics Tooling', 'physics-tooling'];
/** What is worth carrying over: files the shell writes, and Chromium's local storage. */
const ITEMS = ['window-state.json', 'engines.json', 'Local Storage'];
/** Written once the move has been tried, so it is never repeated (even if there was nothing to move). */
const MARKER = 'migrated-from-previous-name.json';

/**
 * Copy saved state from the first legacy folder that exists into `userData`.
 * Does nothing if this has run before or `userData` already holds any of the
 * items (the user has started afresh under the new name; never overwrite).
 * Returns what happened, for logging and tests.
 */
function migrateUserData(userData, appData = path.dirname(userData)) {
  const marker = path.join(userData, MARKER);
  if (fs.existsSync(marker)) return { migrated: false, reason: 'already done' };
  const from = LEGACY_NAMES.map((name) => path.join(appData, name)).find((dir) => dir !== userData && fs.existsSync(dir));
  const result = { migrated: false, reason: from ? '' : 'nothing to migrate', from: from ?? null, copied: [] };
  try {
    fs.mkdirSync(userData, { recursive: true });
    if (from) {
      if (ITEMS.some((item) => fs.existsSync(path.join(userData, item)))) {
        result.reason = 'already in use';
      } else {
        for (const item of ITEMS) {
          const source = path.join(from, item);
          if (!fs.existsSync(source)) continue;
          fs.cpSync(source, path.join(userData, item), { recursive: true });
          result.copied.push(item);
        }
        // A lock held by the old app's storage must not travel with it.
        fs.rmSync(path.join(userData, 'Local Storage', 'leveldb', 'LOCK'), { force: true });
        result.migrated = result.copied.length > 0;
        if (!result.migrated) result.reason = 'nothing to migrate';
      }
    }
    fs.writeFileSync(marker, JSON.stringify({ from: result.from, copied: result.copied, reason: result.reason }, null, 2));
  } catch (err) {
    // Starting with default settings is better than not starting.
    result.reason = `failed: ${err && err.message ? err.message : err}`;
  }
  return result;
}

module.exports = { migrateUserData, LEGACY_NAMES, ITEMS, MARKER };
