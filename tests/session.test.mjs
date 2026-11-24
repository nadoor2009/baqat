import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSession } from '../dist/session.mjs';

test('both clients use the same session implementation', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../dist/session.mjs'), read('../mobile/session.mjs'));
});

test('concurrent requests share one refresh and logout invalidates the session', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).hostname, 'securetoken.googleapis.com');
    assert.equal(options.body, 'grant_type=refresh_token&refresh_token=original');
    return Response.json({ id_token: 'new', refresh_token: 'rotated', expires_in: '3600', user_id: 'customer' });
  });
  const session = createSession({
    localId: 'customer', idToken: 'old', refreshToken: 'original', expiresIn: '0',
  }, 'test-key');
  assert.deepEqual(await Promise.all([session.accessToken(), session.accessToken()]), ['new', 'new']);
  assert.equal(fetch.mock.callCount(), 1);
  session.close();
  await assert.rejects(session.accessToken(), /AUTH_REQUIRED/);
});
