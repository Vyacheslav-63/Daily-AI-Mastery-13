import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AssistantMessage, MasteryProfile } from '../types/curriculum';

interface AssistantViewProps {
  profile: MasteryProfile;
  messages: AssistantMessage[];
  isLoading: boolean;
  error: string | null;
  lastFailedPrompt: string | null;
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  onOpenSettings: () => void;
}

export const AssistantView: React.FC<AssistantViewProps> = ({
  profile,
  messages,
  isLoading,
  error,
  lastFailedPrompt,
  onSendMessage,
  onClearHistory,
  onOpenSettings,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isLoading, error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;
    setInputValue('');
    await onSendMessage(trimmed);
  };

  const handleCopyCode = async (id: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <section
      aria-label="Персональный ИИ-ассистент"
      className="space-y-4 animate-fade-up"
    >
      {/* Compact Adaptive Context Bar */}
      <div className="glass-surface rounded-3xl p-4 sm:p-5 flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-300">
              <Bot className="w-4 h-4 shrink-0" />
              <span>ИИ-ассистент</span>
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-violet-300">
              Уровень {profile.level}/4: {profile.label}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed truncate">
            День {profile.currentDay}: {profile.currentTopic}
          </p>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            aria-label="Очистить историю диалога"
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 text-xs font-medium inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Очистить</span>
          </button>
        )}
      </div>

      {/* Empty State: Adaptive Quick-Start Cards */}
      {messages.length === 0 && !isLoading && (
        <div className="glass-surface rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-50 tracking-tight">
              Ассистент подстраивается под ваш прогресс
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Сам подбирает материал по Дню {profile.currentDay} и углубляет тему по мере прохождения уроков. Нажмите на подсказку или задайте свой вопрос.
            </p>
          </div>

          <div className="space-y-2.5">
            {profile.suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => void onSendMessage(prompt)}
                className="w-full min-h-[50px] text-left px-4 py-3 rounded-2xl bg-slate-900/75 hover:bg-slate-800/90 border border-white/10 hover:border-sky-400/40 text-sm text-slate-100 flex items-center justify-between gap-3 transition-colors"
              >
                <span className="flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{prompt}</span>
                </span>
                <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation Thread */}
      {messages.length > 0 && (
        <div className="space-y-4">
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-md bg-sky-500/20 border border-sky-400/35 px-4 py-3 text-sm text-slate-50 leading-relaxed">
                  {msg.text}
                </div>
              </div>
            ) : (
              <article
                key={msg.id}
                className="glass-surface rounded-3xl p-5 space-y-4 animate-fade-up"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-violet-300">
                    <Bot className="w-3.5 h-3.5" />
                    <span>ИИ-наставник</span>
                  </span>
                  {msg.depthLabel && (
                    <span className="text-slate-400">Уровень: {msg.depthLabel}</span>
                  )}
                </div>

                <div className="space-y-3 text-sm leading-[1.68] text-slate-200">
                  {msg.text
                    .split(/\n{2,}/)
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .map((para, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {para}
                      </p>
                    ))}
                </div>

                {msg.codeSnippet && (
                  <div className="rounded-xl bg-[#04060D] border border-slate-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/80 text-xs text-slate-400">
                      <span className="font-mono">{msg.codeLanguage || 'typescript'}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(msg.id, msg.codeSnippet || '')}
                        className="min-h-[34px] px-2 rounded-lg hover:bg-slate-800 text-slate-300 inline-flex items-center gap-1.5 transition-colors"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-300">Скопировано</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Копировать</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-3.5 overflow-x-auto text-xs leading-relaxed font-mono text-sky-100/90">
                      <code>{msg.codeSnippet}</code>
                    </pre>
                  </div>
                )}

                {msg.keyTakeaways && msg.keyTakeaways.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold text-slate-300">
                      Главное из разбора
                    </p>
                    <ul className="space-y-1.5">
                      {msg.keyTakeaways.map((tip, idx) => (
                        <li
                          key={idx}
                          className="text-xs sm:text-sm text-slate-300 leading-relaxed flex items-start gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.nextDepthSuggestions && msg.nextDepthSuggestions.length > 0 && (
                  <div className="pt-3 border-t border-white/10 space-y-2">
                    <p className="text-xs font-medium text-slate-400">
                      Углубиться дальше:
                    </p>
                    <div className="space-y-2">
                      {msg.nextDepthSuggestions.map((nextPrompt, idx) => (
                        <button
                          key={idx}
                          type="button"
                          disabled={isLoading}
                          onClick={() => void onSendMessage(nextPrompt)}
                          className="w-full min-h-[42px] text-left px-3.5 py-2.5 rounded-xl bg-violet-500/12 hover:bg-violet-500/22 border border-violet-400/30 text-xs sm:text-sm text-violet-100 flex items-center justify-between gap-2 transition-colors disabled:opacity-50"
                        >
                          <span>{nextPrompt}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            )
          )}
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div
          aria-live="polite"
          className="glass-surface rounded-3xl p-5 space-y-3 animate-fade-up"
        >
          <div className="flex items-center gap-2 text-xs text-sky-300 font-medium">
            <Sparkles className="w-4 h-4 animate-pulse" />
            <span>Подбираю материал под уровень «{profile.label}»...</span>
          </div>
          <div className="space-y-2">
            <div className="h-3.5 rounded-lg skeleton-shimmer w-11/12" />
            <div className="h-3.5 rounded-lg skeleton-shimmer w-4/5" />
            <div className="h-3.5 rounded-lg skeleton-shimmer w-2/3" />
          </div>
        </div>
      )}

      {/* Error State with 1-tap Settings shortcut */}
      {error && !isLoading && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 space-y-3 animate-fade-up">
          <p className="text-sm text-rose-200 leading-relaxed">{error}</p>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={onOpenSettings}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Открыть Настройки</span>
            </button>
            {lastFailedPrompt && (
              <button
                type="button"
                onClick={() => void onSendMessage(lastFailedPrompt)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Повторить</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Message Composer */}
      <form
        onSubmit={handleSubmit}
        className="glass-surface-elevated rounded-2xl p-2 flex items-center gap-2"
      >
        <label htmlFor="assistant-question-input" className="sr-only">
          Вопрос ИИ-ассистенту
        </label>
        <input
          id="assistant-question-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isLoading}
          placeholder="Спросите ассистента по теме..."
          className="flex-1 min-w-0 min-h-[46px] px-3.5 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim()}
          aria-label="Отправить вопрос ассистенту"
          className="min-h-[46px] min-w-[46px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-1.5 transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      <div ref={bottomRef} />
    </section>
  );
};
