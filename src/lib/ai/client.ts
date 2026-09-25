import { generateText, streamText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  type ChatTurn,
  type ProviderDef,
  flattenConversation,
  getProvider,
  resolveBaseUrl,
  resolveModel,
} from './providers';
import { getApiKey, useSettingsStore } from '../../store/settingsStore';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Route HTTP calls through the Tauri HTTP plugin so provider APIs aren't
 * blocked by CORS in the webview. Falls back to the browser fetch when the
 * plugin isn't available or the URL is outside its scope.
 */
const aiFetch: typeof fetch = async (input, init) => {
  if (isTauri()) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      return await tauriFetch(input, init);
    } catch (error) {
      const msg = String(error);
      // Scope/permission errors mean the plugin refused; try the webview.
      if (!/not allowed|scope|forbidden/i.test(msg)) throw error;
    }
  }
  return fetch(input, init);
};

export class AiNotConfiguredError extends Error {}

export function activeProvider(): ProviderDef {
  const { activeProvider: id } = useSettingsStore.getState();
  return getProvider(id) ?? getProvider('google')!;
}

/** Human label like "OpenAI · gpt-5-mini". */
export function describeProvider(provider = activeProvider()): string {
  const model = resolveModel(provider, useSettingsStore.getState().models);
  return model ? `${provider.label} · ${model}` : provider.label;
}

/** Build an AI SDK model for an HTTP provider. Throws for CLI providers. */
export async function getLanguageModel(provider = activeProvider()): Promise<LanguageModel> {
  if (provider.kind !== 'api') {
    throw new AiNotConfiguredError(`${provider.label} is a CLI agent and can't be used here.`);
  }
  const state = useSettingsStore.getState();
  const model = resolveModel(provider, state.models);
  if (!model) throw new AiNotConfiguredError(`Set a model for ${provider.label} in Settings → AI.`);

  const apiKey = provider.needsKey || provider.id === 'custom' ? await getApiKey(provider.id) : '';
  if (provider.needsKey && !apiKey) {
    throw new AiNotConfiguredError(`Add your ${provider.label} API key in Settings → AI.`);
  }
  const baseURL = resolveBaseUrl(provider, state.baseUrls);

  switch (provider.flavor) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey, fetch: aiFetch })(model);
    case 'openai':
      return createOpenAI({ apiKey, fetch: aiFetch })(model);
    case 'anthropic':
      return createAnthropic({
        apiKey,
        fetch: aiFetch,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(model);
    case 'openai-compatible':
    default:
      return createOpenAICompatible({
        name: provider.id,
        baseURL: baseURL ?? '',
        apiKey: apiKey || undefined,
        fetch: aiFetch,
        headers:
          provider.id === 'openrouter'
            ? { 'HTTP-Referer': 'https://github.com/daschinmoy21/Logia', 'X-Title': 'Logia' }
            : undefined,
      })(model);
  }
}

interface ChatOptions {
  system: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  provider?: ProviderDef;
}

let cliRequestCounter = 0;

/** Run a CLI agent and stream its stdout. Resolves with the full output. */
async function runCli(
  provider: ProviderDef,
  prompt: string,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const state = useSettingsStore.getState();
  const requestId = `cli-${Date.now()}-${++cliRequestCounter}`;
  const unlisten = await listen<{ request_id: string; kind: string; data: string }>(
    'ai-cli-event',
    (event) => {
      if (event.payload.request_id === requestId && event.payload.kind === 'chunk') {
        onChunk(event.payload.data);
      }
    },
  );
  const onAbort = () => {
    invoke('ai_cli_cancel', { requestId }).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);
  try {
    return await invoke<string>('ai_cli_run', {
      requestId,
      tool: provider.id,
      prompt,
      model: resolveModel(provider, state.models) || null,
      binary: state.cliBinaries[provider.id]?.trim() || null,
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    unlisten();
  }
}

/**
 * Stream a chat reply from the active provider. Yields the accumulated text
 * after every chunk.
 */
export async function* streamChat({ system, messages, signal, provider = activeProvider() }: ChatOptions) {
  if (provider.kind === 'cli') {
    let text = '';
    let done = false;
    let error: unknown = null;
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };

    runCli(
      provider,
      flattenConversation(system, messages),
      (chunk) => {
        text += chunk;
        notify();
      },
      signal,
    )
      .then((full) => {
        // Some CLIs only print once finished; prefer the final output.
        if (full && full.length >= text.trim().length) text = full;
      })
      .catch((e) => {
        error = e;
      })
      .finally(() => {
        done = true;
        notify();
      });

    let lastYielded = '';
    while (true) {
      if (text !== lastYielded) {
        lastYielded = text;
        yield text;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        if (done || text !== lastYielded) resolve();
        else wake = resolve;
      });
    }
    if (error && !signal?.aborted) throw new Error(String(error));
    return;
  }

  const model = await getLanguageModel(provider);
  const result = streamText({ model, system, messages, abortSignal: signal });
  let text = '';
  for await (const delta of result.textStream) {
    text += delta;
    yield text;
  }
}

/** One-shot completion from the active provider. */
export async function complete({
  system,
  prompt,
  provider = activeProvider(),
}: {
  system: string;
  prompt: string;
  provider?: ProviderDef;
}): Promise<string> {
  if (provider.kind === 'cli') {
    return runCli(provider, flattenConversation(system, [{ role: 'user', content: prompt }]), () => {});
  }
  const model = await getLanguageModel(provider);
  const { text } = await generateText({ model, system, prompt });
  return text;
}

/** Turn provider errors into a short, actionable markdown message. */
export function friendlyAiError(error: unknown, provider = activeProvider()): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (error instanceof AiNotConfiguredError) return `⚙️ **Not configured**\n\n${raw}`;
  if (/401|invalid.*key|api key|authentication|unauthorized/i.test(raw)) {
    return `🔑 **API key error**\n\nThe ${provider.label} key looks invalid or expired. Update it in Settings → AI.`;
  }
  if (/429|rate|quota|limit/i.test(raw)) {
    return `⏳ **Rate limited**\n\n${provider.label} rejected the request because of rate limits or quota. Wait a moment and try again.`;
  }
  if (/403|forbidden|permission/i.test(raw)) {
    return `🚫 **Access denied**\n\nYour ${provider.label} account doesn't have access to this model.`;
  }
  if (/404|not.?found|does not exist|unknown model/i.test(raw) && provider.kind === 'api') {
    return `❓ **Model not found**\n\n${provider.label} doesn't recognise the model \`${resolveModel(provider, useSettingsStore.getState().models)}\`. Pick another in Settings → AI.\n\n\`${raw.slice(0, 300)}\``;
  }
  if (/network|fetch|connect|ECONNREFUSED|timed out/i.test(raw)) {
    return provider.group === 'local'
      ? `🔌 **Can't reach ${provider.label}**\n\nIs the local server running at \`${resolveBaseUrl(provider, useSettingsStore.getState().baseUrls)}\`?`
      : `🌐 **Network error**\n\nCouldn't connect to ${provider.label}. Check your internet connection.`;
  }
  return `⚠️ **${provider.label} error**\n\n\`\`\`\n${raw.slice(0, 800)}\n\`\`\``;
}
