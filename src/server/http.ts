import 'server-only';

/**
 * Medical metadata and authentication responses must not enter shared CDN or
 * browser caches. Vary remains explicit for future cookie/bearer enforcement.
 */
export const PRIVATE_NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  Vary: 'Authorization, Cookie',
});
