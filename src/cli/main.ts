/**
 * Entry point of the command-line mode under Node (and, inside the packaged
 * app, under Electron's main process): connects cli.ts to the file system.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { APP_VERSION, FILE_FORMAT } from '../version';
import { COMMANDS, runCli, type ExitCode } from './cli';

export { COMMANDS };

/** Run one command line and return its exit code. */
export function main(argv: string[]): ExitCode {
  return runCli(argv, {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // Say what happened rather than quote the system's error code.
        throw new Error(code === 'ENOENT' ? 'there is no file at that path' : code === 'EISDIR' ? 'that path is a folder, not a file' : code === 'EACCES' ? 'permission to read it was denied' : String((err as Error).message));
      }
    },
    write: (path, text) => writeFileSync(path, text, 'utf8'),
    out: (text) => { process.stdout.write(text); },
    err: (text) => { process.stderr.write(text); },
    now: () => new Date().toISOString(),
    appVersion: APP_VERSION,
    fileFormat: FILE_FORMAT,
  });
}

// Started as a program (node cli.mjs …), not loaded by the desktop shell.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
