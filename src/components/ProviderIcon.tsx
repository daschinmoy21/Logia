import { Server } from 'lucide-react';
import openai from '../assets/providers/openai.svg';
import claude from '../assets/providers/claude-color.svg';
import gemini from '../assets/providers/gemini-color.svg';
import opencode from '../assets/providers/opencode.svg';
import pi from '../assets/providers/pi.svg';
import openrouter from '../assets/providers/openrouter.svg';
import groq from '../assets/providers/groq.svg';
import deepseek from '../assets/providers/deepseek-color.svg';
import mistral from '../assets/providers/mistral-color.svg';
import ollama from '../assets/providers/ollama.svg';
import lmstudio from '../assets/providers/lmstudio.svg';

const marks: Record<string, { src: string; mono?: boolean }> = {
  openai: { src: openai, mono: true }, codex: { src: openai, mono: true },
  anthropic: { src: claude }, 'claude-code': { src: claude },
  google: { src: gemini }, 'gemini-cli': { src: gemini },
  opencode: { src: opencode, mono: true }, pi: { src: pi },
  openrouter: { src: openrouter, mono: true }, groq: { src: groq, mono: true },
  deepseek: { src: deepseek }, mistral: { src: mistral },
  ollama: { src: ollama, mono: true }, lmstudio: { src: lmstudio, mono: true },
  logia: { src: '/logo.png' },
};

/** Decorative: the adjacent provider label supplies the accessible name. */
export function ProviderIcon({ providerId, size = 18, className = '' }: { providerId: string; size?: number; className?: string }) {
  const mark = marks[providerId];
  if (!mark) return <Server aria-hidden size={size} className={`shrink-0 ${className}`} />;
  return <img src={mark.src} alt="" aria-hidden draggable={false} width={size} height={size}
    className={`shrink-0 object-contain ${mark.mono ? 'brightness-0 invert' : ''} ${className}`} />;
}
