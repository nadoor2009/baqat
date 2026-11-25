import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../worker/index.mjs';

test('voucher issues once and can be used once only by the owner before expiry', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/0001_baqat.sql', import.meta.url), 'utf8'));
  const prepare = sql => ({
    bind: (...parameters) => ({
      first: async () => sqlite.prepare(sql).get(...parameters),
      all: async () => ({ results: sqlite.prepare(sql).all(...parameters) }),
    }),
  });
  const owner = 'verified-merchant-account';
  const outsider = 'verified-merchant-outsider';
  const customer = 'verified-customer-account';
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(new URL(url).hostname, 'identitytoolkit.googleapis.com');
    return Response.json({ users: [{ localId: JSON.parse(request.body).idToken, emailVerified: true }] });
  });
  sqlite.prepare('INSERT INTO merchants (user_id, name, approved) VALUES (?, ?, 1)')
    .run(owner, 'Test Merchant');
  const offer = crypto.randomUUID();
  sqlite.prepare(`INSERT INTO offers VALUES
    (?, ?, 'Dinner', 'Venue', 'Hittin', 'Address', 1, 24.75, 46.65,
    11900, 2, 'dinner', 'Dinner for two', ?, ?, 1)`)
    .run(offer, owner, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 3600000).toISOString());
  const env = { DB: { prepare }, FIREBASE_API_KEY: 'test-key' };
  const post = (path, token, body, method = 'POST') => worker.fetch(new Request('https://baqat.local/api/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  }), env);
  const edit = token => post('merchant/offers/' + offer, token, {
    name: 'Updated dinner', venue: 'Venue', district: 'Hittin', address: 'Address',
    north: true, latitude: 24.75, longitude: 46.65, price_halalas: 14900,
    people: 2, meal: 'dinner', inclusions: 'Dinner for two',
    starts_at: new Date(Date.now() - 60000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
  }, 'PUT');
  assert.equal((await edit(outsider)).status, 404);
  const issue = () => post('vouchers', customer, { offer });
  const redeem = (code, token = owner) => post('vouchers/redeem', token, { code }).then(response => response.json());
  const attempts = await Promise.all([issue(), issue()]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409]);
  const [{ code }] = await attempts.find(result => result.status === 201).json();
  const history = token => worker.fetch(new Request('https://baqat.local/api/vouchers', {
    headers: { Authorization: 'Bearer ' + token },
  }), env).then(response => response.json());
  assert.deepEqual(await history(outsider), []);
  const [entry] = await history(customer);
  assert.equal(entry.status, 'active');
  assert.equal(entry.code, undefined);
  assert.equal(entry.token_hash, undefined);
  assert.deepEqual(await redeem(code, outsider), []);
  assert.equal((await edit(owner)).status, 409);
  assert.equal(sqlite.prepare('SELECT price_halalas FROM offers WHERE id = ?').get(offer).price_halalas, 11900);
  const redemptions = await Promise.all([redeem(code), redeem(code)]);
  assert.deepEqual(redemptions.map(result => result.length).sort(), [0, 1]);
  assert.equal((await history(customer))[0].status, 'used');
  assert.equal((await edit(owner)).status, 200);
  assert.equal(sqlite.prepare('SELECT price_halalas, published FROM offers WHERE id = ?').get(offer).price_halalas, 14900);
  assert.equal(sqlite.prepare('SELECT published FROM offers WHERE id = ?').get(offer).published, 1);
  const [{ code: expired }] = await (await issue()).json();
  sqlite.exec("UPDATE vouchers SET expires_at = '2000-01-01T00:00:00.000Z' WHERE redeemed_at IS NULL");
  assert.deepEqual(await redeem(expired), []);
  assert.ok((await history(customer)).some(entry => entry.status === 'expired'));
});

test('merchant approval requires an allowlisted verified account and is idempotent', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../migrations/0001_baqat.sql', import.meta.url), 'utf8'));
  const prepare = sql => ({
    bind: (...parameters) => ({ first: async () => sqlite.prepare(sql).get(...parameters) }),
    all: async () => ({ results: sqlite.prepare(sql).all() }),
  });
  const admin = 'verified-administrator-account';
  const applicant = 'verified-merchant-applicant';
  t.mock.method(globalThis, 'fetch', async (url, request) => Response.json({
    users: [{ localId: JSON.parse(request.body).idToken, emailVerified: true }],
  }));
  const env = { DB: { prepare }, FIREBASE_API_KEY: 'test-key', BAQAT_ADMIN_UIDS: admin };
  const request = (path, token, body) => worker.fetch(new Request('https://baqat.local/api/' + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  assert.equal((await request('merchant', applicant, { name: 'Test Merchant' })).status, 201);
  assert.equal((await request('merchant', applicant, { name: 'Different name' })).status, 200);
  assert.equal((await request('admin/merchants', applicant)).status, 403);
  assert.equal((await request('admin/merchants', applicant, { user_id: applicant })).status, 403);
  const pending = await (await request('admin/merchants', admin)).json();
  assert.deepEqual(pending, [{ user_id: applicant, name: 'Test Merchant' }]);
  assert.equal((await request('admin/merchants', admin, { user_id: applicant })).status, 200);
  assert.equal((await request('admin/merchants', admin, { user_id: applicant })).status, 409);
  const account = await (await request('account', applicant)).json();
  assert.deepEqual(account, { merchant: { name: 'Test Merchant', approved: 1 }, admin: false });
});

test('verified Saudi phone users have account access without admin privileges', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../migrations/0001_baqat.sql', import.meta.url), 'utf8'));
  let phoneNumber = '+966500000001';
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    users: [{ localId: 'phone-customer-uid', emailVerified: false, phoneNumber }],
  }));
  const env = { FIREBASE_API_KEY: 'test-key', BAQAT_ADMIN_UIDS: 'another-uid',
    DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) }) }) } };
  const get = path => worker.fetch(new Request('https://baqat.local/api/' + path, {
    headers: { Authorization: 'Bearer verified-phone-token' },
  }), env);
  assert.deepEqual(await (await get('account')).json(), { merchant: null, admin: false });
  assert.equal((await get('admin/merchants')).status, 403);
  phoneNumber = undefined;
  assert.equal((await get('account')).status, 403);
});
