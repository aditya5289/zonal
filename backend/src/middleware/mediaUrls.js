import { signMediaUrls } from '../lib/storage.js';

/**
 * Turns stored media keys into loadable URLs on the way out.
 *
 * This is done once, here, rather than in each of the twenty-odd handlers
 * that return media. Sprinkling it through the routes would mean every new
 * endpoint is one forgotten call away from shipping raw storage keys that the
 * app cannot render - a bug that only shows up as a broken image.
 *
 * Signed links expire, so only the bare key is ever stored. They are minted
 * per response, batched into a single round trip however many appear.
 */

/** A value that looks like something we put in storage. */
const isStoredKey = (v) =>
  typeof v === 'string' && (v.startsWith('supabase:') || v.startsWith('/uploads/'));

/** Collect every stored key anywhere in the payload. */
function collect(node, found, depth = 0) {
  if (!node || depth > 8) return;

  if (Array.isArray(node)) {
    for (const item of node) collect(item, found, depth + 1);
    return;
  }

  if (typeof node !== 'object') return;

  for (const value of Object.values(node)) {
    if (isStoredKey(value)) found.add(value);
    else collect(value, found, depth + 1);
  }
}

/** Swap them for the signed versions in place. */
function replace(node, signed, depth = 0) {
  if (!node || depth > 8) return;

  if (Array.isArray(node)) {
    for (const item of node) replace(item, signed, depth + 1);
    return;
  }

  if (typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (isStoredKey(value)) {
      if (signed.has(value)) node[key] = signed.get(value);
    } else {
      replace(value, signed, depth + 1);
    }
  }
}

export function signMediaInResponses(req, res, next) {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    const found = new Set();
    collect(body, found);

    if (found.size === 0) return sendJson(body);

    signMediaUrls([...found])
      .then((signed) => {
        replace(body, signed);
        sendJson(body);
      })
      .catch((err) => {
        // A failure to sign should not fail the request - the client shows a
        // broken image rather than an error page, and the cause is logged.
        console.error('Could not sign media URLs:', err.message);
        sendJson(body);
      });

    return res;
  };

  next();
}
