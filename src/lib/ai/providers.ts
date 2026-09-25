/**
 * Registry of AI backends Logia can talk to.
 *
 * - "api" providers are called over HTTP through the AI SDK.
 * - "cli" providers shell out to a locally installed coding-agent CLI.
 */

export type ProviderKind = 'api' | 'cli';
export type ProviderGroup = 'cloud' | 'local' | 'cli';

export type ApiFlavor = 'google' | 'openai' | 'anthropic' | 'openai-compatible';

export interface ProviderDef {
  id: string;
  label: string;
  kind: ProviderKind;
  group: ProviderGroup;
  /** Which SDK adapter to use (api providers only). */
  flavor?: ApiFlavor;
  needsKey: boolean;
  /** true when the user may override the endpoint. */
  editableBaseUrl?: boolean;
  defaultBaseUrl?: string;
  defaultModel: string;
  /** Suggestions for the model field; any string is accepted. */
  models: string[];
  keyUrl?: string;
  hint?: string;
  /** Binary looked up on PATH (cli providers only). */
  binary?: string;
  installHint?: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'google',
    label: 'Google Gemini',
    kind: 'api',
    group: 'cloud',
    flavor: 'google',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'api',
    group: 'cloud',
    flavor: 'openai',
    needsKey: true,
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'api',
    group: 'cloud',
    flavor: 'anthropic',
    needsKey: true,
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'api',
    group: 'cloud',
    flavor: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5-mini',
    models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat'],
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'One key, hundreds of models. Use the provider/model id from openrouter.ai/models.',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'api',
    group: 'cloud',
    flavor: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'api',
    group: 'cloud',
    flavor: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'api',
    group: 'cloud',
    flavor: 'openai-compatible',
    needsKey: true,
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-medium-latest',
    models: ['mistral-medium-latest', 'mistral-small-latest', 'codestral-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'api',
    group: 'local',
    flavor: 'openai-compatible',
    needsKey: false,
    editableBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'qwen3', 'gemma3', 'mistral'],
    hint: 'Runs fully offline. Pull a model first: ollama pull llama3.2',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'api',
    group: 'local',
    flavor: 'openai-compatible',
    needsKey: false,
    editableBaseUrl: true,
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    models: [],
    hint: 'Start the local server in LM Studio (Developer tab) and use the loaded model id.',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'api',
    group: 'local',
    flavor: 'openai-compatible',
    needsKey: false,
    editableBaseUrl: true,
    defaultBaseUrl: 'http://localhost:8080/v1',
    defaultModel: '',
    models: [],
    hint: 'Any server that speaks the OpenAI chat completions API (llama.cpp, vLLM, LiteLLM, …). The API key is optional.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    kind: 'cli',
    group: 'cli',
    needsKey: false,
    binary: 'claude',
    defaultModel: '',
    models: ['sonnet', 'opus', 'haiku'],
    installHint: 'npm i -g @anthropic-ai/claude-code',
    hint: 'Uses your Claude subscription via `claude -p`.',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    kind: 'cli',
    group: 'cli',
    needsKey: false,
    binary: 'codex',
    defaultModel: '',
    models: ['gpt-5', 'gpt-5-codex'],
    installHint: 'npm i -g @openai/codex',
    hint: 'Runs `codex exec` in a read-only sandbox.',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    kind: 'cli',
    group: 'cli',
    needsKey: false,
    binary: 'opencode',
    defaultModel: '',
    models: ['anthropic/claude-sonnet-5', 'openai/gpt-5'],
    installHint: 'curl -fsSL https://opencode.ai/install | bash',
    hint: 'Runs `opencode run`. Models use the provider/model form.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    kind: 'cli',
    group: 'cli',
    needsKey: false,
    binary: 'gemini',
    defaultModel: '',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    installHint: 'npm i -g @google/gemini-cli',
    hint: 'Runs `gemini -p` with your Google login.',
  },
];

export const GROUP_LABELS: Record<ProviderGroup, string> = {
  cloud: 'Cloud APIs',
  local: 'Local & self-hosted',
  cli: 'CLI agents',
};

export function getProvider(id: string | undefined | null): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Model to use for a provider given the user's per-provider overrides. */
export function resolveModel(provider: ProviderDef, overrides: Record<string, string>): string {
  const override = overrides[provider.id]?.trim();
  return override || provider.defaultModel;
}

export function resolveBaseUrl(provider: ProviderDef, overrides: Record<string, string>): string | undefined {
  if (!provider.editableBaseUrl) return provider.defaultBaseUrl;
  const override = overrides[provider.id]?.trim();
  return (override || provider.defaultBaseUrl)?.replace(/\/+$/, '');
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * CLI agents take a single prompt, so the system prompt and conversation are
 * flattened into one transcript ending with the latest user message.
 */
export function flattenConversation(system: string, turns: ChatTurn[]): string {
  const parts: string[] = [];
  if (system.trim()) parts.push(system.trim());
  const history = turns.slice(0, -1);
  const last = turns[turns.length - 1];
  if (history.length) {
    parts.push(
      '## Conversation so far\n\n' +
        history.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n'),
    );
  }
  if (last) {
    parts.push(`## Latest user message\n\n${last.content}`);
  }
  parts.push('Reply directly to the latest user message. Do not run tools or modify files.');
  return parts.join('\n\n');
}
