/**
 * HTTP plumbing: CORS, JSON bodies, and the bearer token.
 *
 * The storefront is a different origin from the Edge Function, so every
 * response carries the headers the browser needs to read it. `Access-Control-
 * Allow-Origin: *` is correct here: the function authenticates with a Supabase
 * access token, never a cookie, so there is no ambient credential for a
 * cross-site request to ride on.
 */

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  // `x-application-name` is not decoration: `@supabase/supabase-js` attaches it
  // to every request when the client sets `global.headers`, which ours does, so
  // it goes out on `functions.invoke` too. Omitting it from this list made the
  // browser's preflight fail, the POST never left the page, and checkout
  // reported the useless `TypeError: Failed to fetch`. The request never
  // reached the function, so nothing on this side could explain it.
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-application-name',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
};

export function jsonResponse(body: unknown, status: number, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(requestId === undefined ? {} : { 'x-request-id': requestId }),
    },
  });
}

/**
 * The preflight answer.
 *
 * The allow-list above is the floor; this echoes back whatever the browser
 * actually asked for, so a client that grows a header is not rejected by a list
 * nobody remembered to update. The union keeps the documented set intact even
 * when the request header is absent.
 */
export function preflightResponse(request?: Request): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS };
  const requested = request?.headers.get('access-control-request-headers');

  if (requested !== null && requested !== undefined && requested.trim() !== '') {
    const asked = requested
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== '');
    const allowed = (CORS_HEADERS['access-control-allow-headers'] ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== '');
    headers['access-control-allow-headers'] = [...new Set([...allowed, ...asked])].join(', ');
  }

  return new Response(null, { status: 204, headers });
}

/**
 * The caller's access token, or `null`.
 *
 * Nothing about the identity is read from the body or a query parameter: a
 * client-supplied user id is the one bug SPEC names explicitly, so the only
 * thing this function takes from the request is a token it verifies itself.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token.length === 0 ? null : token;
}

/** The runtime's correlation id, when it supplied one. */
export function readRequestId(request: Request): string | undefined {
  return request.headers.get('x-request-id') ?? undefined;
}
