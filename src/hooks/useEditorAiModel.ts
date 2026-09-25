import { useEffect, useState } from 'react';
import type { LanguageModel } from 'ai';
import { getLanguageModel } from '../lib/ai/client';
import { getProvider } from '../lib/ai/providers';
import { isProviderReady, useSettingsStore } from '../store/settingsStore';

/**
 * The AI SDK model for BlockNote's inline AI menu. Only HTTP providers can
 * drive it; with a CLI provider (or nothing configured) this returns null.
 * `signature` changes whenever the model changes, so the editor can remount.
 */
export function useEditorAiModel(): { model: LanguageModel | null; signature: string } {
  const providerId = useSettingsStore((s) => s.activeProvider);
  const modelName = useSettingsStore((s) => s.models[s.activeProvider] ?? '');
  const baseUrl = useSettingsStore((s) => s.baseUrls[s.activeProvider] ?? '');
  const ready = useSettingsStore((s) => isProviderReady(s.activeProvider, s));
  const [state, setState] = useState<{ model: LanguageModel | null; signature: string }>({
    model: null,
    signature: 'no-ai',
  });

  useEffect(() => {
    const provider = getProvider(providerId);
    if (!provider || provider.kind !== 'api' || !ready) {
      setState({ model: null, signature: 'no-ai' });
      return;
    }
    let cancelled = false;
    getLanguageModel(provider)
      .then((model) => {
        if (!cancelled) setState({ model, signature: `${providerId}:${modelName}:${baseUrl}` });
      })
      .catch(() => {
        if (!cancelled) setState({ model: null, signature: 'no-ai' });
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, modelName, baseUrl, ready]);

  return state;
}
