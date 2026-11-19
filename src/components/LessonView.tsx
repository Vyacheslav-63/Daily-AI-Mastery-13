import React, { useState } from 'react';
import {
  ArrowRight,
  Bell,
  BellRing,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Layers,
  Lock,
  RefreshCw,
  Settings,
} from 'lucide-react';
import type { Lesson } from '../types/curriculum';
import { formatCountdown } from '../lib/curriculumEngine';
import { formatReminderTime } from '../lib/pushNotifications';
import { DeepDiveSkeleton, LessonSkeleton } from './LessonSkeleton';

interface LessonViewProps {
  lesson: Lesson | null;
  isLoadingLesson: boolean;
  lessonError: string | null;
  isCompleted: boolean;
  isNextDayUnlocked: boolean;
  msUntilNextUnlock: number;
  fastTrackMode: boolean;
  isDeepDiveLoading: boolean;
  deepDiveError: string | null;
  remindersEnabled: boolean;
  unlockAtMs?: number;
  onEnableReminders: () => Promise<void>;
  onRetryLesson: () => void;
  onRequestDeepDive: () => void;
  onCompleteLesson: () => void;
  onOpenNextDay: () => void;
  onOpenRoadmap: () => void;
  onOpenSettings: () => void;
  onAskAssistant: () => void;
}

export const LessonView: React.FC<LessonViewProps> = ({
  lesson,
  isLoadingLesson,
  lessonError,
  isCompleted,
  isNextDayUnlocked,
  msUntilNextUnlock,
  fastTrackMode,
  isDeepDiveLoading,
  deepDiveError,
  remindersEnabled,
  unlockAtMs,
  onEnableReminders,
  onRetryLesson,
  onRequestDeepDive,
  onCompleteLesson,
  onOpenNextDay,
  onOpenRoadmap,
  onOpenSettings,
  onAskAssistant,
}) => {
  const [copiedBlock, setCopiedBlock] = useState<'main' | 'deep' | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const handleCopy = async (code: string, which: 'main' | 'deep') => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBlock(which);
      setTimeout(() => setCopiedBlock(null), 1800);
    } catch {
      // Clipboard API unavailable in restricted context
    }
  };

  if (isLoadingLesson) {
    return <LessonSkeleton />;
  }

  if (lessonError || !lesson) {
    return (
      <div className="glass-surface rounded-3xl p-6 sm:p-8 space-y-4 animate-fade-up">
        <h2 className="text-xl font-bold text-slate-100">
          Ошибка загрузки урока
        </h2>
        <p className="text-sm text-rose-300 leading-relaxed">
          {lessonError || 'Не удалось получить содержимое урока.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRetryLesson}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Повторить генерацию</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-violet-100 font-semibold text-sm flex items-center gap-2 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span>Открыть Настройки</span>
          </button>
          <button
            type="button"
            onClick={onOpenRoadmap}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors"
          >
            К программе
          </button>
        </div>
      </div>
    );
  }

  const paragraphs = lesson.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="space-y-6 animate-fade-up">
      {/* Main Lesson Card */}
      <div className="glass-surface rounded-3xl overflow-hidden">
        {lesson.day === 1 && (
          <div className="relative h-32 sm:h-48 w-full overflow-hidden border-b border-white/10 bg-slate-900">
            {!heroImgFailed ? (
              <img
                src="/src/assets/images/hero_neural_infra_1794952060484.jpg"
                alt="Архитектура распределённой ИИ-инфраструктуры"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-900 via-sky-950/60 to-violet-950/50 flex items-center justify-center">
                <Layers className="w-10 h-10 text-sky-400/60" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#070B14] via-[#070B14]/45 to-transparent" />
          </div>
        )}

        <div className="p-6 sm:p-8 space-y-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="text-sky-300 font-semibold">День {lesson.day}</span>
              <span aria-hidden="true">·</span>
              <span>{lesson.category}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{lesson.readMinutes} мин чтения</span>
              {!lesson.isPreinstalled && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-violet-300">Сгенерировано Gemini</span>
                </>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-50 leading-tight text-balance tracking-tight">
              {lesson.topic}
            </h1>
          </header>

          <div className="space-y-4 text-[15.5px] leading-[1.7] text-slate-200 max-w-prose">
            {paragraphs.map((para, index) => {
              const lines = para.split('\n').map((l) => l.trim());
              const bulletLines = lines.filter((l) => l.startsWith('- '));
              if (bulletLines.length > 0) {
                const introLines = lines.filter((l) => !l.startsWith('- '));
                return (
                  <div key={index} className="space-y-2.5">
                    {introLines.length > 0 && (
                      <p className="text-slate-200">{introLines.join(' ')}</p>
                    )}
                    <ul className="space-y-2 pl-4 list-disc marker:text-sky-400">
                      {bulletLines.map((b, bIdx) => (
                        <li key={bIdx} className="text-slate-200 pl-1">
                          {b.slice(2)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
              return (
                <p key={index} className="whitespace-pre-line">
                  {para}
                </p>
              );
            })}
          </div>

          {lesson.codeExample && (
            <div className="rounded-2xl bg-[#050811] border border-slate-800/90 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 text-xs text-slate-400">
                <span className="font-mono">{lesson.codeLanguage || 'typescript'}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(lesson.codeExample || '', 'main')}
                  className="min-h-[36px] px-2.5 rounded-lg hover:bg-slate-800/80 text-slate-300 flex items-center gap-1.5 transition-colors"
                >
                  {copiedBlock === 'main' ? (
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
              <pre className="p-4 overflow-x-auto text-xs sm:text-[13px] leading-relaxed font-mono text-sky-100/90">
                <code>{lesson.codeExample}</code>
              </pre>
            </div>
          )}

          {/* Deep Dive & Adaptive Assistant Triggers */}
          <div className="pt-2 border-t border-white/10">
            {!isDeepDiveLoading && (
              <div className="flex flex-col sm:flex-row gap-2.5">
                {!lesson.deepDive && (
                  <button
                    type="button"
                    aria-expanded={false}
                    onClick={onRequestDeepDive}
                    className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-2xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/35 text-violet-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <Layers className="w-4 h-4 shrink-0" />
                    <span>Углубиться в тему</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onAskAssistant}
                  className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-2xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Bot className="w-4 h-4 shrink-0" />
                  <span>Разобрать с ИИ-ассистентом</span>
                </button>
              </div>
            )}

            {isDeepDiveLoading && <DeepDiveSkeleton />}

            {deepDiveError && !isDeepDiveLoading && (
              <div className="mt-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 p-4 space-y-3 animate-fade-up">
                <p className="text-sm text-rose-200 leading-relaxed">{deepDiveError}</p>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span>Открыть Настройки</span>
                  </button>
                  <button
                    type="button"
                    onClick={onRequestDeepDive}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-100 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Повторить Deep Dive</span>
                  </button>
                </div>
              </div>
            )}

            {lesson.deepDive && (
              <section
                aria-label="Углублённый технический разбор"
                className="mt-6 rounded-2xl bg-slate-950/60 border border-violet-400/25 p-5 sm:p-6 space-y-5 animate-fade-up"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base sm:text-lg font-bold text-violet-200 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-violet-400" />
                    <span>Углублённый технический разбор</span>
                  </h2>
                  <span className="text-xs text-slate-400">Архитектура и код</span>
                </div>

                <div className="space-y-3 text-sm leading-relaxed text-slate-200">
                  {lesson.deepDive.overview
                    .split(/\n{2,}/)
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .map((para, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {para}
                      </p>
                    ))}
                </div>

                {lesson.deepDive.code && (
                  <div className="rounded-xl bg-[#04060D] border border-slate-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/80 text-xs text-slate-400">
                      <span className="font-mono">{lesson.deepDive.language || 'typescript'}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(lesson.deepDive?.code || '', 'deep')}
                        className="min-h-[34px] px-2 rounded-lg hover:bg-slate-800 text-slate-300 flex items-center gap-1.5 transition-colors"
                      >
                        {copiedBlock === 'deep' ? (
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
                    <pre className="p-4 overflow-x-auto text-xs leading-relaxed font-mono text-violet-100/90">
                      <code>{lesson.deepDive.code}</code>
                    </pre>
                  </div>
                )}

                {lesson.deepDive.tips.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-slate-300">
                      Чек-лист для продакшена
                    </h3>
                    <ul className="space-y-2">
                      {lesson.deepDive.tips.map((tip, idx) => (
                        <li
                          key={idx}
                          className="text-sm text-slate-300 leading-relaxed flex items-start gap-2.5"
                        >
                          <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-1" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Completion / Next-Day Gate Card */}
      <div className="glass-surface-elevated rounded-3xl p-6 space-y-4">
        {!isCompleted ? (
          <>
            <div className="space-y-1">
              <h2 className="text-base font-bold text-slate-100">
                Закрепление материала
              </h2>
              <p className="text-sm text-slate-300">
                Завершите урок, чтобы зафиксировать серию и подготовить контрольный вопрос на следующий день.
              </p>
            </div>
            <button
              type="button"
              onClick={onCompleteLesson}
              className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-sky-500/15"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>Завершить урок Дня {lesson.day}</span>
            </button>
          </>
        ) : isNextDayUnlocked ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Урок Дня {lesson.day} завершён</span>
              </p>
              <p className="text-xs text-slate-300">
                {fastTrackMode
                  ? 'Режим тренажёра активен — следующий день открыт сразу.'
                  : 'Следующий день уже доступен для изучения.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenNextDay}
              className="min-h-[48px] px-5 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Перейти ко Дню {lesson.day + 1}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Урок Дня {lesson.day} успешно усвоен</span>
                </p>
                <p className="text-xs text-slate-300 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>
                    День {lesson.day + 1} откроется через{' '}
                    <strong className="font-mono tabular-nums text-sky-300">
                      {formatCountdown(msUntilNextUnlock)}
                    </strong>
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenRoadmap}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Clock className="w-4 h-4" />
                <span>Смотреть программу</span>
              </button>
            </div>

            <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {remindersEnabled ? (
                <p className="text-xs text-sky-300 flex items-center gap-2">
                  <BellRing className="w-4 h-4 shrink-0" />
                  <span>
                    Push-напоминание включено
                    {unlockAtMs ? ` · придёт в ${formatReminderTime(unlockAtMs)}` : ''}
                  </span>
                </p>
              ) : (
                <>
                  <p className="text-xs text-slate-400">
                    Не пропустите следующий урок — включите Push-напоминание.
                  </p>
                  <button
                    type="button"
                    onClick={() => void onEnableReminders()}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Bell className="w-4 h-4" />
                    <span>Напомнить о Дне {lesson.day + 1}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
};
