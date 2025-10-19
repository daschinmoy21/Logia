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

interface AiSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const AiSidebar = ({ isOpen, onClose }: AiSidebarProps) => {
  const { currentNote } = useNotesStore();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const scrollableContainerRef = useRef<HTMLDivElement>(null);

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

  const handleSendMessage = async (message: string, files?: File[]) => {
    if (!message.trim()) return;
    if (!apiKey) {
      alert('Google API key not configured. Please set GOOGLE_GENERATIVE_AI_API_KEY in your environment.');
      return;
    }

    // Add user message
    const userMessage = { role: 'user' as const, content: message };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingMessage('');

    try {
      // Call Gemini with conversation history
      const systemPrompt = 'You are KAi, a helpful AI assistant in a note-taking app called Kortex. Help users with their notes, writing, research, and general questions.';
      const noteContext = currentNote ? `\n\nHere is the content of the current note for context:\n---\n${currentNote.content}\n---` : '';

      const result = await streamText({
        model: google('gemini-2.5-flash'),
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
      setMessages(prev => [...prev, assistantMessage]);
      setStreamingMessage('');
    } catch (error) {
      console.error('AI error:', error);
      const errorMessage = { role: 'assistant' as const, content: 'Sorry, I encountered an error.' };
      setMessages(prev => [...prev, errorMessage]);
      setStreamingMessage('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Resizable
      defaultSize={{ width: 320, height: '100%' }}
      enable={{ left: true }}
      minWidth={270}
      maxWidth={600}
    >
      <div className="h-full bg-zinc-900 border-l border-zinc-500 flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-200">AI Assistant</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 flex flex-col overflow-hidden">
        {/* Chat messages area */}
        <div ref={scrollableContainerRef} className="flex-1 mb-4 overflow-y-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-zinc-400">
              <h2 className="text-lg mb-2">Welcome to your AI assistant</h2>
              <p>Ask me anything!</p>
            </div>
          )}
          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-3 rounded-lg ${ 
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-700 text-zinc-200'
              }`}>
                {msg.role === 'user' ? msg.content : <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>}
              </div>
            </div>
          ))}
          {isLoading && streamingMessage && (
            <div className="flex justify-start">
              <div className="bg-zinc-700 text-zinc-200 p-3 rounded-lg">
                <Markdown remarkPlugins={[remarkGfm]}>{streamingMessage}</Markdown>
              </div>
            </div>
          )}
          {isLoading && !streamingMessage && (
            <div className="flex justify-start p-1 text-zinc-300">
              <Loader /> 
            </div>
          )}
        </div>
        <PromptInputBox onSend={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
    </Resizable>
  );
};

export default AiSidebar;
