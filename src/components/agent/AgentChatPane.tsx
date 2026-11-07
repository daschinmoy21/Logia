import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, Check, FileText, History, Loader2, LockKeyhole, Paperclip, Plus, Settings2, Terminal, Trash2, X } from 'lucide-react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
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
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, PillSelect } from '../ui/menu';
import { ProviderIcon } from '../ProviderIcon';
import { AgentComposer } from './AgentComposer';
import { AgentTerminalPane } from './AgentTerminalPane';
import { deleteAgentHistory, newAgentChat, resumeAgentChat, sendAgentChat, setAgentChatIncludeNote, setAgentChatOptions, stopAgentChat, useAgentChats, useAgentHistory } from './agentChats';

const accessLabels = { 'read-only': 'Read only', 'workspace-write': 'Workspace', 'danger-full-access': 'Full access' };
const effortLabels: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const terminalViews = new Set<AgentTool>();
/** Chosen files wait for the next send, even across closing the panel or switching agents. */
const pendingFiles = new Map<AgentTool, string[]>();
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export function AgentChatPane({ tool, onSwitchAgent }: { tool: AgentTool; onSwitchAgent: (agent: AgentTool) => void }) {
  const def = AGENT_TOOLS.find((t) => t.id === tool)!;
  const chat = useAgentChats((s) => s.chats[tool]);
  const history = useAgentHistory((s) => s[tool]) ?? [];
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
  const [files, setFilesState] = useState<string[]>(() => pendingFiles.get(tool) ?? []);
  const setFiles = (next: string[]) => {
    pendingFiles.set(tool, next);
    setFilesState(next);
  };
  const pendingPrompt = useUiStore((s) => s.pendingAiPrompt);
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

  const noteAttachable = !!note && note.note_type !== 'canvas';

  const send = (text: string) => {
    const body = files.length ? `${text}\n\nAttached files:\n${files.map((path) => `- ${path}`).join('\n')}` : text;
    const sent = sendAgentChat(tool, body, { access: tool === 'codex' ? access : undefined, reasoningEffort: selectedEffort || undefined }, attach && noteAttachable ? { id: note.id, title: note.title || 'Untitled', markdown: noteToMarkdown(note.content) } : undefined);
    if (sent) setFiles([]);
    return sent;
  };

  // The vim `:ai <prompt>` command hands its prompt to whichever agent is open.
  useEffect(() => {
    if (!pendingPrompt || terminalOpen || running) return;
    useUiStore.getState().setPendingAiPrompt(null);
    send(pendingPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, terminalOpen, running]);

  const chooseFiles = async () => {
    try {
      const chosen = await openFileDialog({ multiple: true });
      if (chosen?.length) setFiles([...new Set([...files, ...chosen])]);
    } catch (error) {
      toast.error(`Couldn't attach files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (terminalOpen) return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-8 items-center border-b border-zinc-800 px-1.5">
      <Button variant="ghost" size="sm" onClick={() => setTerminalOpen(false)}><ArrowLeft size={13} /> Back to chat</Button>
    </div>
    <AgentTerminalPane tool={tool} />
  </div>;

  return <div className="flex h-full min-h-0 flex-col" data-testid="agent-chat">
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-1.5">
      <div className="flex items-center">
        <Button variant="ghost" size="sm" onClick={() => newAgentChat(tool)}><Plus size={13} /> New session</Button>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={running}><History size={13} /> History</Button>
          </MenuTrigger>
          <MenuContent className="w-72" aria-label={`${def.label} session history`}>
            {history.length === 0 && <MenuLabel>No past sessions yet</MenuLabel>}
            {history.map((item) => <MenuItem key={item.id} icon={item.id === chat?.id ? <Check size={13} /> : undefined} onSelect={() => resumeAgentChat(tool, item.id)}>
              <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate">{item.title}</span><span className="shrink-0 text-[11px] text-zinc-500">{when(item.updatedAt)}</span></span>
            </MenuItem>)}
            {history.length > 0 && <>
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={13} />} onSelect={() => deleteAgentHistory(tool)}>Clear {def.label} history</MenuItem>
            </>}
          </MenuContent>
        </Menu>
      </div>
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
      {(noteAttachable || files.length > 0) && <div className="mx-2.5 flex flex-wrap items-center gap-1 pt-1">
        {noteAttachable && (attach
          ? <span className="flex h-6 max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] pl-1.5 pr-0.5 text-xs text-zinc-300"><FileText size={12} className="shrink-0 text-zinc-500" /><span className="min-w-0 truncate">Current note: {note.title || 'Untitled'}</span><button type="button" onClick={() => setAttach(false)} aria-label="Remove attached note" className="flex size-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100"><X size={12} /></button></span>
          : <button type="button" disabled={running} onClick={() => setAttach(true)} aria-label="Attach current note" className="flex h-6 items-center gap-1 rounded-md border border-dashed border-zinc-700 px-1.5 text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40"><Plus size={12} /> Current note</button>)}
        {files.map((path) => <span key={path} title={path} className="flex h-6 max-w-48 items-center gap-1.5 rounded-md bg-white/[0.06] pl-1.5 pr-0.5 text-xs text-zinc-300"><Paperclip size={12} className="shrink-0 text-zinc-500" /><span className="min-w-0 truncate">{fileName(path)}</span><button type="button" onClick={() => setFiles(files.filter((item) => item !== path))} aria-label={`Remove ${fileName(path)}`} className="flex size-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100"><X size={12} /></button></span>)}
      </div>}
      <AgentComposer key={chat?.id ?? tool} draftKey={`chat:${tool}:${chat?.id ?? 'new'}`} label={`Message ${def.label}`} placeholder="Ask for changes or send a follow-up" busy={running} canSend={desktop && info?.available !== false}
        sendLabel={`Send to ${def.label}`} onStop={() => stopAgentChat(tool)}
        onSend={send}
        leading={<>
          <IconButton label="Attach files" hint={desktop ? 'Attach files or images' : 'Attaching files needs the desktop app'} side="top" disabled={running || !desktop} onClick={() => void chooseFiles()}><Paperclip size={14} /></IconButton>
          <ModelPicker providerId={tool} scope="agents" onSwitchAgent={onSwitchAgent} disabled={running} defaultModelLabel={selected?.label} />
          {tool === 'codex' && <>
            <PillSelect label="Reasoning effort" icon={<Brain size={13} />} side="top" value={selectedEffort} disabled={running} onChange={(value) => setAgentChatOptions(tool, { reasoningEffort: value || undefined })}
              options={[{ value: '', label: 'Default' }, ...efforts.map((value) => ({ value, label: effortLabels[value] }))]} />
            <PillSelect label="Agent access" icon={<LockKeyhole size={13} />} side="top" value={access} disabled={running} onChange={(value) => setAgentChatOptions(tool, { access: value as typeof access })}
              options={Object.entries(accessLabels).map(([value, label]) => ({ value, label }))} />
          </>}
        </>}
      />
    </div>
  </div>;
}
