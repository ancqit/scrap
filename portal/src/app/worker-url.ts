/**
 * Same-origin prefix. The browser never calls 127.0.0.1.
 * ng serve proxies /api to wrangler. Vercel rewrites /api to the deployed Worker.
 */
export const WORKER_URL = '/api';
