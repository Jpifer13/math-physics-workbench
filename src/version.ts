declare const __APP_VERSION__: string;

/** Version of the app, recorded in saved files and in the header of every export. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Version of the .physsim / .physflow file format. Raise it, and add a migration, when the format changes. */
export const FILE_FORMAT = 1;
