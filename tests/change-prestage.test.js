const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

// Import the server (starts Bun server)
require('../server/server.ts'); // using ts extension, but Node can import via ts-node? However server uses Bun APIs; for test we can mock fetch to call server routes via Bun's built-in fetch which runs in same process.

// Set up axios mock adapter
const mock = new MockAdapter(axios);

// Mock token acquisition (any POST to /api/oauth/token)
mock.onPost(/\/api\/oauth\/token/).reply(200, { access_token: 'fake-token' });

// Mock removal endpoint (delete-multiple) – respond success
mock.onPost(/\/scope\/delete-multiple/).reply(200, { success: true });

// Mock the POST to add device to prestage – echo back payload
mock.onPost(/\/api\/v2\/computer-prestages\/\d+\/scope/).reply(config => {
  return [200, { added: true, payload: JSON.parse(config.data) }];
});

// Mock calls used in the flow for current assignments and prestage list
mock.onGet(/\/api\/v2\/computer-prestages\/\d+\/scope/).reply(200, { serialNumbers: [] });
mock.onGet(/\/api\/v2\/computer-prestages/).reply(200, { results: [{ id: '123', displayName: 'Test Prestage', versionLock: 'N/A' }] });

// Helper to perform HTTP request against the running server
async function request(method, path, query = {}) {
  const url = new URL(`http://localhost${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method });
  const data = await res.json();
  return { status: res.status, data };
}

test('dry‑run returns payload without contacting Jamf', async () => {
  const { status, data } = await request('POST', '/api/change-prestage/computers/123/NEWDEV', { dryRun: 'true' });
  expect(status).toBe(200);
  expect(data.dryRun).toBe(true);
  expect(data.method).toBe('POST');
  expect(data.body.serialNumbers).toContain('NEWDEV');
  const postCalls = (mock.history && mock.history.post) ? mock.history.post.filter(c => /\/api\/v2\/computer-prestages/.test(c.url)) : [];
  expect(postCalls.length).toBe(0);
});

test('adds device via POST without overwriting existing devices', async () => {
  const { status, data } = await request('POST', '/api/change-prestage/computers/123/NEWDEV');
  expect(status).toBe(200);
  expect(data.added).toBe(true);
  expect(data.payload.serialNumbers).toEqual(['NEWDEV']);
  const postCalls = (mock.history && mock.history.post) ? mock.history.post.filter(c => /\/api\/v2\/computer-prestages/.test(c.url)) : [];
  expect(postCalls.length).toBeGreaterThan(0);
});
