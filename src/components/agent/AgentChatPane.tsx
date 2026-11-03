import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, ChevronDown, Loader2, LockKeyhole, Paperclip, Plus, Settings2, Terminal, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AGENT_TOOLS, isDesktopAgentHost, type AgentTool } from '../../lib/ai/agent-terminal';
import { loadProviderModels, type CatalogModel } from '../../lib/ai/model-catalog';
import { noteToMarkdown } from '../../lib/note-markdown';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';
import useUiStore from '../../store/UiStore';
import { ModelPicker } from '../ModelPicker';
import { ProviderIcon } from '../ProviderIcon';
import { AgentComposer } from './AgentComposer';
import { AgentTerminalPane } from './AgentTerminalPane';
import { newAgentChat, sendAgentChat, setAgentChatOptions, stopAgentChat, useAgentChats } from './agentChats';

const accessLabels = { 'read-only': 'Read only', 'workspace-write': 'Workspace', 'danger-full-access': 'Full access' };
const effortLabels: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const terminalViews = new Set<AgentTool>();

export function AgentChatPane({ tool }: { tool: AgentTool }) {
  const def = AGENT_TOOLS.find((t) => t.id === tool)!;
  const chat = useAgentChats((s) => s.chats[tool]);
  const model = useSettingsStore((s) => s.models[tool]);
  const binary = useSettingsStore((s) => s.cliBinaries[tool]);
  const info = useSettingsStore((s) => s.cliStatus[tool]);
  const note = useNotesStore((s) => s.currentNote);
  const [terminalOpen, setTerminalOpenState] = useState(() => terminalViews.has(tool));
  const setTerminalOpen = (open: boolean) => {
    if (open) terminalViews.add(tool);
    else terminalViews.delete(tool);
    setTerminalOpenState(open);
  };
  const [attach, setAttach] = useState(false);
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const effort = chat?.options.reasoningEffort ?? '';
  const access = chat?.options.access ?? 'read-only';
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const desktop = isDesktopAgentHost();
  const running = chat?.running ?? false;
  const selected = catalog.find((m) => m.id === model) ?? (!model ? catalog.find((m) => m.isDefault) ?? catalog[0] : undefined);
  const efforts = selected?.reasoningEfforts?.filter((value) => value in effortLabels) ?? [];
  const selectedEffort = efforts.includes(effort) ? effort : '';

  useEffect(() => {
    if (!useAgentChats.getState().chats[tool]) newAgentChat(tool);
  }, [tool]);

  useEffect(() => {
    let current = true;
    setCatalog([]);
    if (desktop && tool === 'codex') void loadProviderModels(tool).then((models) => { if (current) setCatalog(models); }, () => {});
    return () => { current = false; };
  }, [tool, binary, desktop, model]);

  useEffect(() => setAttach(false), [note?.id]);
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, chat?.streaming]);
  useEffect(() => {
    if (!terminalOpen) composer.current?.querySelector('textarea')?.focus();
  }, [chat?.id, terminalOpen]);

  if (terminalOpen) return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center border-b border-zinc-900 px-3 py-2">
      <button type="button" onClick={() => setTerminalOpen(false)} className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-100"><ArrowLeft size={14} /> Back to chat</button>
    </div>
    <AgentTerminalPane tool={tool} />
  </div>;

  return <div className="flex h-full min-h-0 flex-col bg-zinc-950" data-testid="agent-chat">
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
      <button type="button" onClick={() => newAgentChat(tool)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"><Plus size={14} /> New session</button>
      <div className="flex items-center gap-1">
        {running && <span role="status" className="mr-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400"><Loader2 size={12} className="animate-spin" /> Working</span>}
        <button type="button" onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'ai')} aria-label="Agent provider settings" title="Provider settings" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"><Settings2 size={14} /></button>
        <button type="button" onClick={() => setTerminalOpen(true)} aria-label="Open agent terminal" title="Terminal and sign-in" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"><Terminal size={14} /></button>
      </div>
    </div>

    <div ref={transcript} role="log" aria-label={`${def.label} conversation`} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {!chat?.messages.length && <div className="flex min-h-full flex-col items-center justify-center pb-10 text-center">
        <ProviderIcon providerId={tool} size={32} className="mb-5 opacity-80" />
        <h3 className="text-lg font-medium tracking-tight text-zinc-100">What can I help you with?</h3>
        <p className="mt-2 max-w-64 text-sm leading-6 text-zinc-500">Ask {def.label} about your notes, or start with an idea.</p>
      </div>}
      <div className="space-y-6">
        {chat?.messages.map((message, index) => <div key={index} className={message.role === 'user' ? 'ml-6 rounded-2xl bg-zinc-800/70 px-4 py-3 text-sm leading-6 text-zinc-100' : 'break-words text-sm leading-6 text-zinc-300 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_p]:mb-3'}>
          {message.role === 'assistant' && <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500"><ProviderIcon providerId={tool} size={14} />{def.label}</div>}
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>)}
        {running && <div className="break-words text-sm leading-6 text-zinc-300 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3">
          {chat?.streaming ? <Markdown remarkPlugins={[remarkGfm]}>{chat.streaming}</Markdown> : <span className="inline-flex items-center gap-2 text-zinc-500"><Loader2 size={14} className="animate-spin" /> Thinking…</span>}
        </div>}
        {chat?.error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-300"><Markdown remarkPlugins={[remarkGfm]}>{chat.error}</Markdown></div>}
      </div>
    </div>

    {!desktop && <p className="px-4 py-2 text-xs text-zinc-500">Open the desktop app to chat with {def.label}.</p>}
    {desktop && info?.available === false && <p className="px-4 py-2 text-xs text-amber-300">{def.label} wasn’t found. <button type="button" onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'ai')} className="underline underline-offset-2">Set its binary path</button>.</p>}
    <div ref={composer} className="shrink-0">
      {attach && note && <div className="mx-4 mb-1 flex items-center gap-2 text-xs text-zinc-400"><Paperclip size={12} /><span className="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span><button type="button" onClick={() => setAttach(false)} aria-label="Remove attached note"><X size={12} /></button></div>}
      <AgentComposer key={chat?.id ?? tool} draftKey={`chat:${tool}:${chat?.id ?? 'new'}`} autoFocus label={`Message ${def.label}`} placeholder="Ask for changes, send follow-ups, or attach a note" busy={running} canSend={desktop && info?.available !== false}
        sendLabel={`Send to ${def.label}`} onStop={() => stopAgentChat(tool)}
        onSend={(text) => sendAgentChat(tool, text, { access: tool === 'codex' ? access : undefined, reasoningEffort: selectedEffort || undefined }, attach && note ? { title: note.title || 'Untitled', markdown: noteToMarkdown(note.content) } : undefined)}
        leading={<>
          <ModelPicker providerId={tool} disabled={running} defaultModelLabel={selected?.label} />
          {tool === 'codex' && <>
            <label title="Reasoning effort" className="relative inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"><Brain size={13} /><select aria-label="Reasoning effort" value={selectedEffort} disabled={running} onChange={(event) => setAgentChatOptions(tool, { reasoningEffort: event.target.value || undefined })} className="max-w-24 appearance-none bg-transparent pr-3 text-xs focus:outline-none"><option value="">Default</option>{efforts.map((value) => <option key={value} value={value}>{effortLabels[value]}</option>)}</select><ChevronDown size={10} className="pointer-events-none absolute right-1" /></label>
            <label title="Agent access" className="relative inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"><LockKeyhole size={13} /><select aria-label="Agent access" value={access} disabled={running} onChange={(event) => setAgentChatOptions(tool, { access: event.target.value as typeof access })} className="max-w-24 appearance-none bg-transparent pr-3 text-xs focus:outline-none">{Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={10} className="pointer-events-none absolute right-1" /></label>
          </>}
          <button type="button" disabled={running || !note || note.note_type === 'canvas'} onClick={() => setAttach((value) => !value)} aria-label="Attach current note" aria-pressed={attach} title={note ? 'Attach current note' : 'Open a note to attach it'} className={`rounded-md p-1.5 hover:bg-zinc-800 disabled:opacity-30 ${attach ? 'text-indigo-300' : 'text-zinc-500'}`}><Paperclip size={14} /></button>
        </>}
      />
    </div>
  </div>;
}
