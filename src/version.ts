declare const __APP_VERSION__: string;
declare const __WEB_BUILD__: boolean;

/** True in the build made for tablets and browsers (npm run build:web), false in the desktop app and in tests. */
export const WEB_BUILD: boolean = typeof __WEB_BUILD__ === 'boolean' ? __WEB_BUILD__ : false;

/** Version of the app, recorded in saved files and in the header of every export. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Version of the .physsim / .physflow file format. Raise it, and add a migration, when the format changes. */
export const FILE_FORMAT = 5;
