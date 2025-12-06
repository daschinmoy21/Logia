import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { useNotesStore } from "@/store/notesStore";
import { Resizable } from 're-resizable';
import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Loader from "@/components/Ai-loader";
import { ShimmeringText } from "../components/animate-ui/text/shimmering";
import { Bot, User, Trash2, X } from 'lucide-react';

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const AiSidebar = ({ isOpen, onClose }: AiSidebarProps) => {
  const { currentNote } = useNotesStore();
  const [messagesMap, setMessagesMap] = useState<Record<string, { role: 'user' | 'assistant', content: string }[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const scrollableContainerRef = useRef<HTMLDivElement>(null);

  // Get messages for current note
  const messages = currentNote ? messagesMap[currentNote.id] || [] : [];

  useEffect(() => {
    if (scrollableContainerRef.current) {
      scrollableContainerRef.current.scrollTop = scrollableContainerRef.current.scrollHeight;
    }
  }, [messages, streamingMessage]);

  useEffect(() => {
    const fetchApiKey = async () => {
      try {
        const key = await invoke<string>('get_google_api_key');
        setApiKey(key);
      } catch (error) {
        console.error('Failed to get API key:', error);
      }
    };
    fetchApiKey();
  }, []);

  const google = createGoogleGenerativeAI({ apiKey });

  if (!isOpen) return null;

  const handleClearChat = () => {
    if (currentNote) {
      setMessagesMap(prev => ({
        ...prev,
        [currentNote.id]: []
      }));
    }
  };

  const handleSendMessage = async (message: string, files?: File[]) => {
    if (!message.trim()) return;
    if (!apiKey) {
      alert('Google API key not configured. Please set GOOGLE_GENERATIVE_AI_API_KEY in your environment.');
      return;
    }
    if (!currentNote) return;

    // Add user message
    const userMessage = { role: 'user' as const, content: message };
    setMessagesMap(prev => ({
      ...prev,
      [currentNote.id]: [...(prev[currentNote.id] || []), userMessage]
    }));
    setIsLoading(true);
    setStreamingMessage('');

    try {
      // Call Gemini with conversation history
      const systemPrompt = 'You are KAi, a helpful AI assistant in a note-taking app called Kortex. Help users with their notes, writing, research, and general questions.Keep responses crisp unless specified.';
      const noteContext = currentNote ? `\n\nHere is the content of the current note for context:\n---\n${currentNote.content}\n---` : '';

      const result = await streamText({
        model: google('gemini-2.5-flash-lite'),
        system: systemPrompt + noteContext,
        messages: [...messages, userMessage], // Include all previous + current user
      });

      let fullResponse = '';
      for await (const delta of result.textStream) {
        fullResponse += delta;
        setStreamingMessage(fullResponse);
      }

      // Add assistant message
      const assistantMessage = { role: 'assistant' as const, content: fullResponse };
      setMessagesMap(prev => ({
        ...prev,
        [currentNote.id]: [...(prev[currentNote.id] || []), assistantMessage]
      }));
      setStreamingMessage('');
    } catch (error) {
      console.error('AI error:', error);
      const errorMessage = { role: 'assistant' as const, content: 'Sorry, I encountered an error.' };
      setMessagesMap(prev => ({
        ...prev,
        [currentNote.id]: [...(prev[currentNote.id] || []), errorMessage]
      }));
      setStreamingMessage('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Resizable
      defaultSize={{ width: 350, height: '100%' }}
      enable={{ left: true }}
      minWidth={300}
      maxWidth={600}
      handleClasses={{ left: 'w-1 bg-zinc-800 hover:bg-zinc-600 transition-colors' }}
    >
      <div className="h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-zinc-100 font-medium text-sm tracking-wide">AI Assistant</span>
            {messages.length > 0 && (
              <span className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full border border-zinc-700">
                {messages.length} msgs
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleClearChat}
              className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800/50 rounded-md transition-all"
              title="Clear Chat"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 rounded-md transition-all"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-hidden relative flex flex-col">
          <div ref={scrollableContainerRef} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-60 mt-10">
                <div className="bg-zinc-900/50 p-4 rounded-2xl mb-4 border border-zinc-800">
                  <Bot size={32} className="text-blue-500 mb-2 mx-auto" />
                  <p className="text-zinc-400 text-sm font-medium">How can I help you with your notes today?</p>
                </div>
              </div>
            )}
            
            {messages.map((msg, index) => (
              <div key={index} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`flex-shrink-0 mt-1 size-7 rounded-full flex items-center justify-center border ${
                  msg.role === 'user' ? 'bg-zinc-800 border-zinc-700' : 'bg-blue-600/10 border-blue-500/20'
                }`}>
                  {msg.role === 'user' ? (
                    <User size={14} className="text-zinc-400" />
                  ) : (
                    <Bot size={14} className="text-blue-400" />
                  )}
                </div>

                <div className={`flex-1 max-w-[85%] text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-zinc-800 text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tr-sm border border-zinc-700/50' 
                    : 'text-zinc-300'
                }`}>
                  <div className="prose prose-invert prose-p:my-1 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-md prose-code:text-blue-300 prose-code:bg-zinc-800/50 prose-code:px-1 prose-code:rounded prose-sm max-w-none">
                  <Markdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({className, children, ...props}) {
                        const match = /language-(\w+)/.exec(className || '')
                        return match ? (
                          <div className="relative group my-2">
                             <code className={className} {...props}>
                                {children}
                             </code>
                          </div>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {msg.content}
                  </Markdown>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && streamingMessage && (
               <div className="flex gap-3">
                 <div className="flex-shrink-0 mt-1 size-7 rounded-full flex items-center justify-center bg-blue-600/10 border border-blue-500/20">
                   <Bot size={14} className="text-blue-400" />
                 </div>
                 <div className="flex-1 text-sm text-zinc-300 leading-relaxed">
                   <div className="prose prose-invert prose-p:my-1 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-pre:rounded-md prose-code:text-blue-300 prose-code:bg-zinc-800/50 prose-code:px-1 prose-code:rounded prose-sm max-w-none">
                   <Markdown 
                    remarkPlugins={[remarkGfm]} 
                   >
                     {streamingMessage}
                   </Markdown>
                   </div>
                 </div>
               </div>
            )}

            {isLoading && !streamingMessage && (
              <div className="flex gap-3 items-center">
                 <div className="flex-shrink-0 size-7 rounded-full flex items-center justify-center bg-blue-600/10 border border-blue-500/20">
                    <Loader />      
                 </div>
                 <ShimmeringText
                    className="text-xs font-medium text-zinc-500"
                    text="Thinking..."
                    wave 
                 />
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 bg-zinc-950 border-t border-zinc-800">
          <PromptInputBox onSend={handleSendMessage} isLoading={isLoading} />
        </div>
      </div>
    </Resizable>
  );
};

export default AiSidebar;
