const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const meals = new Set(['lunch', 'dinner', 'both']);
const iso = time => new Date(time).toISOString();
const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function requireValid(valid) {
  if (!valid) throw new ApiError(400, 'INVALID_INPUT');
}

function string(value, min, max) {
  requireValid(typeof value === 'string');
  const cleaned = value.trim();
  requireValid(cleaned.length >= min && cleaned.length <= max);
  return cleaned;
}

function number(value, min, max, integer = false) {
  requireValid(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
  if (integer) requireValid(Number.isInteger(value));
  return value;
}

async function body(request) {
  const reader = request.body?.getReader();
  requireValid(reader);
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8192) {
      await reader.cancel();
      throw new ApiError(413, 'INVALID_INPUT');
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const parsed = JSON.parse(text + decoder.decode());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // All malformed payloads receive the same response.
  }
  throw new ApiError(400, 'INVALID_INPUT');
}

async function actor(request, env) {
  if (!env.FIREBASE_API_KEY) throw new ApiError(503, 'AUTH_UNCONFIGURED');
  const token = /^Bearer (\S{20,4096})$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED');
  const reply = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
    encodeURIComponent(env.FIREBASE_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  if (!reply.ok) {
    if (reply.status === 400 || reply.status === 401) throw new ApiError(401, 'AUTH_REQUIRED');
    throw new ApiError(503, 'AUTH_UNAVAILABLE');
  }
  const user = (await reply.json()).users?.[0];
  if (!user?.localId || user.disabled) throw new ApiError(401, 'AUTH_REQUIRED');
  if (user.emailVerified !== true) throw new ApiError(403, 'EMAIL_UNVERIFIED');
  return user.localId;
}

async function search(params, db) {
  const start = Date.parse(params.get('day') + 'T00:00:00+03:00');
  const people = number(Number(params.get('people')), 1, 100, true);
  const budget = number(Number(params.get('budget')), 100, 10000000, true);
  const meal = params.get('meal');
  const area = params.get('area');
  requireValid(Number.isFinite(start) && meals.has(meal) && ['all', 'north'].includes(area));
  const { results } = await db.prepare(`
    SELECT o.id, o.name, o.venue, o.district, o.address, o.latitude, o.longitude,
           o.price_halalas, o.people, o.meal, o.inclusions, o.starts_at, o.ends_at
    FROM offers o JOIN merchants m ON m.user_id = o.merchant_id
    WHERE o.published = 1 AND m.approved = 1 AND o.starts_at < ? AND o.ends_at > ?
      AND o.price_halalas <= ? AND o.people >= ?
      AND (? = 'both' OR o.meal IN (?, 'both'))
      AND (? = 'all' OR o.north = 1)
    ORDER BY o.price_halalas, o.id LIMIT 100
  `).bind(iso(start + 86400000), iso(Math.max(start, Date.now())), budget, people, meal, meal, area).all();
  return results;
}

async function createOffer(db, uid, input) {
  const { meal, north } = input;
  requireValid(meals.has(meal) && typeof north === 'boolean');
  const starts = Date.parse(string(input.starts_at, 16, 32));
  const ends = Date.parse(string(input.ends_at, 16, 32));
  requireValid(Number.isFinite(starts) && Number.isFinite(ends) && ends > Math.max(starts, Date.now()));
  const result = await db.prepare(`
    INSERT INTO offers (
      id, merchant_id, name, venue, district, address, north, latitude, longitude,
      price_halalas, people, meal, inclusions, starts_at, ends_at
    )
    SELECT ?, m.user_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM merchants m WHERE m.user_id = ? AND m.approved = 1
    RETURNING id
  `).bind(crypto.randomUUID(), string(input.name, 2, 120), string(input.venue, 2, 120),
    string(input.district, 2, 80), string(input.address, 3, 240), Number(north),
    number(input.latitude, 24.35, 25.10), number(input.longitude, 46.30, 47.10),
    number(input.price_halalas, 100, 10000000, true), number(input.people, 1, 100, true),
    meal, string(input.inclusions, 3, 1800), iso(starts), iso(ends), uid).first();
  if (!result) throw new ApiError(403, 'MERCHANT_REQUIRED');
  return result;
}

async function hash(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function issue(db, uid, offer) {
  requireValid(typeof offer === 'string' && uuid.test(offer));
  const code = crypto.randomUUID();
  const now = Date.now();
  const result = await db.prepare(`
    INSERT INTO vouchers (token_hash, customer_id, offer_id, issued_at, expires_at)
    SELECT ?, ?, o.id, ?, min(o.ends_at, ?)
    FROM offers o JOIN merchants m ON m.user_id = o.merchant_id
    WHERE o.id = ? AND o.merchant_id <> ? AND o.published = 1 AND m.approved = 1
      AND o.starts_at <= ? AND o.ends_at > ?
      AND (SELECT count(*) FROM vouchers WHERE customer_id = ? AND issued_at > ?) < 10
      AND NOT EXISTS (
        SELECT 1 FROM vouchers WHERE customer_id = ? AND offer_id = o.id
          AND expires_at > ? AND redeemed_at IS NULL
      )
    RETURNING expires_at
  `).bind(await hash(code), uid, iso(now), iso(now + 1800000), offer, uid, iso(now),
    iso(now), uid, iso(now - 3600000), uid, iso(now)).first();
  if (!result) throw new ApiError(409, 'ISSUE_DENIED');
  return [{ code, expires_at: result.expires_at }];
}

async function redeem(db, uid, code) {
  requireValid(typeof code === 'string' && uuid.test(code));
  const now = iso(Date.now());
  const used = await db.prepare(`
    UPDATE vouchers SET redeemed_at = ?
    WHERE token_hash = ? AND redeemed_at IS NULL AND expires_at > ?
      AND offer_id IN (
        SELECT o.id FROM offers o JOIN merchants m ON m.user_id = o.merchant_id
        WHERE o.merchant_id = ? AND o.published = 1 AND m.approved = 1
      )
    RETURNING (SELECT name FROM offers WHERE id = offer_id) AS offer_name
  `).bind(now, await hash(code), now, uid).first();
  return used ? [used] : [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (method === 'GET' && path === '/api/config') return json({ apiKey: env.FIREBASE_API_KEY || '' });
      if (method === 'GET' && path === '/api/offers') return json(await search(url.searchParams, env.DB));
      const uid = await actor(request, env);
      const db = env.DB;
      if (path === '/api/merchant') {
        if (method === 'GET') {
          const profile = await db.prepare('SELECT name, approved FROM merchants WHERE user_id = ?').bind(uid).first();
          return json(profile ? [profile] : []);
        }
        if (method === 'POST') {
          const input = await body(request);
          await db.prepare('INSERT INTO merchants (user_id, name) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING')
            .bind(uid, string(input.name, 2, 100)).run();
          return json({}, 201);
        }
      }
      if (path === '/api/merchant/offers') {
        if (method === 'GET') {
          const { results } = await db.prepare('SELECT id, name, published FROM offers WHERE merchant_id = ? ORDER BY starts_at DESC')
            .bind(uid).all();
          return json(results);
        }
        if (method === 'POST') return json(await createOffer(db, uid, await body(request)), 201);
      }
      const update = /^\/api\/merchant\/offers\/([a-f0-9-]+)$/.exec(path);
      if (update && method === 'PATCH') {
        const input = await body(request);
        requireValid(uuid.test(update[1]) && typeof input.published === 'boolean');
        const edited = await db.prepare(`
          UPDATE offers SET published = ?
          WHERE id = ? AND merchant_id = ? AND (? = 0 OR ends_at > ?)
            AND EXISTS (SELECT 1 FROM merchants WHERE user_id = ? AND approved = 1)
          RETURNING id
        `).bind(Number(input.published), update[1], uid, Number(input.published), iso(Date.now()), uid).first();
        if (!edited) throw new ApiError(404, 'OFFER_UNAVAILABLE');
        return json(edited);
      }
      if (method === 'POST' && path === '/api/vouchers') return json(await issue(db, uid, (await body(request)).offer), 201);
      if (method === 'POST' && path === '/api/vouchers/redeem') return json(await redeem(db, uid, (await body(request)).code));
      return json({ message: 'NOT_FOUND' }, 404);
    } catch (error) {
      if (error instanceof ApiError) return json({ message: error.message }, error.status);
      return json({ message: 'REQUEST_FAILED' }, 500);
    }
  },
};
