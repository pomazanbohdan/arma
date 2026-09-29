const REPORT_URL = 'https://voting.arma.gov.ua/voting/public/hashed_report.txt';
const ALLOWED_ORIGINS = new Set([
  'https://pomazanbohdan.github.io',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
]);

function responseHeaders(origin, extra = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'X-Proxy-Fetched-At, Last-Modified, ETag');
    headers.append('Vary', 'Origin');
  }
  return headers;
}

function errorResponse(message, status, origin) {
  return new Response(message, {
    status,
    headers: responseHeaders(origin),
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return errorResponse('Origin not allowed', 403, '');
    }
    if (url.pathname === '/health' && request.method === 'GET') {
      const headers = responseHeaders(origin);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({ ok: true, service: 'arma-report-proxy' }), { headers });
    }
    if (url.pathname !== '/report') return errorResponse('Not found', 404, origin);
    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(origin, {
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept',
        'Access-Control-Max-Age': '600',
      });
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return errorResponse('Method not allowed', 405, origin);
    }

    try {
      const upstream = await fetch(REPORT_URL, {
        headers: { Accept: 'text/plain' },
        cf: { cacheEverything: true, cacheTtl: 15 },
      });
      if (!upstream.ok) return errorResponse('Source report unavailable', 502, origin);

      const length = Number(upstream.headers.get('Content-Length'));
      if (Number.isFinite(length) && length > 20_000_000) {
        return errorResponse('Source report is too large', 502, origin);
      }

      const headers = responseHeaders(origin, {
        'X-Proxy-Fetched-At': new Date().toISOString(),
      });
      for (const name of ['ETag', 'Last-Modified']) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: 200,
        headers,
      });
    } catch (error) {
      console.error('ARMA report fetch failed:', error);
      return errorResponse('Source report unavailable', 502, origin);
    }
  },
};
