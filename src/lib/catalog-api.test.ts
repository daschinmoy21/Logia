import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchApiCatalog } from './ai/catalog-api.ts';

test('model catalogs read all Anthropic pages and preserve live names without putting credentials in URLs', async () => {
  const calls: URL[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(new Headers(init?.headers).get('x-api-key'), 'test-key');
    assert.ok(!url.toString().includes('test-key'));
    return Response.json(calls.length === 1
      ? { data: [{ id: 'new-from-server', display_name: 'Latest server name' }], has_more: true, last_id: 'page-one' }
      : { data: [{ id: 'another-from-server', display_name: 'Another server name' }], has_more: false });
  };
  const models = await fetchApiCatalog({ flavor: 'anthropic', baseUrl: 'https://catalog.example/v1', apiKey: 'test-key' }, request);
  assert.deepEqual(models.map((m) => m.id), ['new-from-server', 'another-from-server']);
  assert.equal(models[0].label, 'Latest server name');
  assert.equal(calls[1].searchParams.get('after_id'), 'page-one');
});

test('Gemini catalogs use reported generation support and page tokens', async () => {
  let count = 0;
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    count++;
    if (count === 2) assert.equal(url.searchParams.get('pageToken'), 'next-page');
    return Response.json(count === 1 ? { models: [
      { name: 'models/fresh-chat', displayName: 'Fresh chat', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
    ], nextPageToken: 'next-page' } : { models: [{ name: 'models/second-chat', supportedGenerationMethods: ['generateContent'] }] });
  };
  const models = await fetchApiCatalog({ flavor: 'google', baseUrl: 'https://catalog.example/v1beta', apiKey: 'test-key' }, request);
  assert.deepEqual(models.map((m) => m.id), ['fresh-chat', 'second-chat']);
});

test('compatible catalogs report current defaults, and failures never produce invented model lists', async () => {
  const request: typeof fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key');
    return Response.json({ data: [{ id: 'server-choice', name: 'Server choice' }], default_model: 'server-choice' });
  };
  const config = { flavor: 'openai-compatible' as const, baseUrl: 'https://catalog.example/v1', apiKey: 'test-key' };
  assert.equal((await fetchApiCatalog(config, request))[0].isDefault, true);
  await assert.rejects(fetchApiCatalog(config, async () => new Response('', { status: 401 })), /HTTP 401/);
  await assert.rejects(fetchApiCatalog(config, async () => Response.json({ data: [] })), /no available chat models/);
  await assert.rejects(fetchApiCatalog(config, async () => Response.json({ data: [], has_more: true, last_id: 'same' })), /repeated/);
});
