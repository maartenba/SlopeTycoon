declare const __APP_VERSION__: string | undefined;
/** App version from package.json (injected by vite `define`; 'dev' under tests). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
