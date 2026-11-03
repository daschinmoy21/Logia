export interface CatalogModel {
  id: string;
  label: string;
  isDefault?: boolean;
  reasoningEfforts?: string[];
}

export interface CatalogRequest {
  flavor: 'google' | 'anthropic' | 'openai-compatible';
  baseUrl: string;
  apiKey?: string;
}

/** Read the provider's catalog, including every page, without naming any models. */
export async function fetchApiCatalog(config: CatalogRequest, request: typeof fetch = fetch): Promise<CatalogModel[]> {
  const headers = new Headers({ Accept: 'application/json' });
  if (config.flavor === 'anthropic') {
    headers.set('anthropic-version', '2023-06-01');
    if (config.apiKey) headers.set('x-api-key', config.apiKey);
  } else if (config.flavor === 'google') {
    if (config.apiKey) headers.set('x-goog-api-key', config.apiKey);
  } else if (config.apiKey) headers.set('Authorization', `Bearer ${config.apiKey}`);

  const models = new Map<string, CatalogModel>();
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/models`;
  const signal = AbortSignal.timeout(20_000);
  const cursors = new Set<string>();
  let cursor = '';
  for (let page = 0; page < 100; page++) {
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set(config.flavor === 'google' ? 'pageToken' : config.flavor === 'anthropic' ? 'after_id' : 'after', cursor);
    const response = await request(url, { headers, signal });
    if (!response.ok) throw new Error(`Could not fetch models (HTTP ${response.status}). Check this provider's connection and credentials.`);
    const body = await response.json();
    const entries = config.flavor === 'google' ? body.models : body.data;
    if (!Array.isArray(entries)) throw new Error('This endpoint did not return a model catalog. Check the base URL.');
    for (const entry of entries) {
      if (config.flavor === 'google' && !entry.supportedGenerationMethods?.includes('generateContent')) continue;
      const rawId = config.flavor === 'google' ? entry.name : entry.id;
      if (typeof rawId !== 'string' || !rawId.trim()) continue;
      const id = config.flavor === 'google' ? rawId.replace(/^models\//, '') : rawId;
      const title = entry.display_name || entry.displayName || (config.flavor === 'google' ? id : entry.name);
      models.set(id, { id, label: typeof title === 'string' && title.trim() ? title : id,
        isDefault: entry.isDefault === true || entry.is_default === true || body.default_model === id });
    }
    const next = config.flavor === 'google' ? body.nextPageToken : body.has_more ? body.last_id || entries[entries.length - 1]?.id : null;
    if (!next) {
      if (!models.size) throw new Error('This provider returned no available chat models. Check its setup or refresh.');
      return [...models.values()];
    }
    if (typeof next !== 'string' || cursors.has(next)) throw new Error('The provider repeated a model catalog page.');
    cursors.add(next);
    cursor = next;
  }
  throw new Error('The model catalog exceeded the pagination limit.');
}
