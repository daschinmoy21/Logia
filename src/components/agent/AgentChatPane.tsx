import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, Loader2, LockKeyhole, Paperclip, Plus, Settings2, Terminal, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AGENT_TOOLS, isDesktopAgentHost, type AgentTool } from '../../lib/ai/agent-terminal';
import { loadProviderModels, type CatalogModel } from '../../lib/ai/model-catalog';
import { noteToMarkdown } from '../../lib/note-markdown';
import { useNotesStore } from '../../store/notesStore';
import { useSettingsStore } from '../../store/settingsStore';
import useUiStore from '../../store/UiStore';
import { ModelPicker } from '../ModelPicker';
import { Button, IconButton } from '../ui/kit';
import { PillSelect } from '../ui/menu';
import { ProviderIcon } from '../ProviderIcon';
import { AgentComposer } from './AgentComposer';
import { AgentTerminalPane } from './AgentTerminalPane';
import { newAgentChat, sendAgentChat, setAgentChatIncludeNote, setAgentChatOptions, stopAgentChat, useAgentChats } from './agentChats';

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
  const attach = chat?.includeNote ?? true;
  const setAttach = (includeNote: boolean) => setAgentChatIncludeNote(tool, includeNote);
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

  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, chat?.streaming]);
  useEffect(() => {
    // A hover reveal must not pull the caret out of the note being typed in.
    if (!terminalOpen && !composer.current?.closest('[data-ai-peek]')) composer.current?.querySelector('textarea')?.focus();
  }, [chat?.id, terminalOpen]);

  if (terminalOpen) return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-8 items-center border-b border-zinc-800 px-1.5">
      <Button variant="ghost" size="sm" onClick={() => setTerminalOpen(false)}><ArrowLeft size={13} /> Back to chat</Button>
    </div>
    <AgentTerminalPane tool={tool} />
  </div>;

  return <div className="flex h-full min-h-0 flex-col" data-testid="agent-chat">
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-1.5">
      <Button variant="ghost" size="sm" onClick={() => newAgentChat(tool)}><Plus size={13} /> New session</Button>
      <div className="flex items-center gap-1">
        {running && <span role="status" className="mr-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400"><Loader2 size={12} className="animate-spin" /> Working</span>}
        <IconButton label="Agent provider settings" hint="Provider settings" onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'ai')}><Settings2 size={14} /></IconButton>
        <IconButton label="Open agent terminal" hint="Terminal and sign-in" onClick={() => setTerminalOpen(true)}><Terminal size={14} /></IconButton>
      </div>
    </div>

    <div ref={transcript} role="log" aria-label={`${def.label} conversation`} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {!chat?.messages.length && <div className="flex min-h-full flex-col justify-end px-1 pb-2">
        <ProviderIcon providerId={tool} size={20} className="mb-3 opacity-80" />
        <h3 className="text-[13px] font-medium text-zinc-200">Ask {def.label}</h3>
        <p className="mt-0.5 text-xs leading-5 text-zinc-500">About your notes, or start with an idea.</p>
      </div>}
      <div className="space-y-5">
        {chat?.messages.map((message, index) => <div key={index} className={message.role === 'user' ? 'chat-prose ml-8 rounded-lg bg-white/[0.06] px-3 py-2' : 'chat-prose'}>
          {message.role === 'assistant' && <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500"><ProviderIcon providerId={tool} size={14} />{def.label}</div>}
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        </div>)}
        {running && <div className="chat-prose">
          {chat?.streaming ? <Markdown remarkPlugins={[remarkGfm]}>{chat.streaming}</Markdown> : <span className="inline-flex items-center gap-2 text-zinc-500"><Loader2 size={14} className="animate-spin" /> Thinking…</span>}
        </div>}
        {chat?.error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs leading-5 text-red-300"><Markdown remarkPlugins={[remarkGfm]}>{chat.error}</Markdown></div>}
      </div>
    </div>

    {!desktop && <p className="px-4 py-2 text-xs text-zinc-500">Open the desktop app to chat with {def.label}.</p>}
    {desktop && info?.available === false && <p className="px-4 py-2 text-xs text-amber-300">{def.label} wasn’t found. <button type="button" onClick={() => useUiStore.getState().setIsSettingsOpen(true, 'ai')} className="underline underline-offset-2">Set its binary path</button>.</p>}
    <div ref={composer} className="shrink-0">
      {attach && note && note.note_type !== 'canvas' && <div className="mx-3.5 flex h-6 items-center gap-1.5 text-xs text-zinc-500"><Paperclip size={12} /><span className="min-w-0 flex-1 truncate">Current note: {note.title || 'Untitled'}</span><button type="button" onClick={() => setAttach(false)} aria-label="Remove attached note"><X size={12} /></button></div>}
      <AgentComposer key={chat?.id ?? tool} draftKey={`chat:${tool}:${chat?.id ?? 'new'}`} label={`Message ${def.label}`} placeholder="Ask for changes, send follow-ups, or attach a note" busy={running} canSend={desktop && info?.available !== false}
        sendLabel={`Send to ${def.label}`} onStop={() => stopAgentChat(tool)}
        onSend={(text) => sendAgentChat(tool, text, { access: tool === 'codex' ? access : undefined, reasoningEffort: selectedEffort || undefined }, attach && note && note.note_type !== 'canvas' ? { id: note.id, title: note.title || 'Untitled', markdown: noteToMarkdown(note.content) } : undefined)}
        leading={<>
          <ModelPicker providerId={tool} disabled={running} defaultModelLabel={selected?.label} />
          {tool === 'codex' && <>
            <PillSelect label="Reasoning effort" icon={<Brain size={13} />} side="top" value={selectedEffort} disabled={running} onChange={(value) => setAgentChatOptions(tool, { reasoningEffort: value || undefined })}
              options={[{ value: '', label: 'Default' }, ...efforts.map((value) => ({ value, label: effortLabels[value] }))]} />
            <PillSelect label="Agent access" icon={<LockKeyhole size={13} />} side="top" value={access} disabled={running} onChange={(value) => setAgentChatOptions(tool, { access: value as typeof access })}
              options={Object.entries(accessLabels).map(([value, label]) => ({ value, label }))} />
          </>}
          <button type="button" disabled={running || !note || note.note_type === 'canvas'} onClick={() => setAttach(!attach)} aria-label="Attach current note" aria-pressed={attach && !!note && note.note_type !== 'canvas'} title={note ? 'Include the current note' : 'Open a note to attach it'} className={`flex size-7 items-center justify-center rounded-md hover:bg-white/[0.07] disabled:opacity-30 ${attach && note && note.note_type !== 'canvas' ? 'text-zinc-200' : 'text-zinc-500'}`}><Paperclip size={14} /></button>
        </>}
      />
    </div>
  </div>;
}
