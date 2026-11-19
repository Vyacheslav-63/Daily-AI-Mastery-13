import React from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { Lesson, UserProgress } from '../types/curriculum';
import {
  calculateAccuracyPercent,
  formatCountdown,
  getNextUnlockStatus,
  isWeeklyReviewDay,
} from '../lib/curriculumEngine';

interface RoadmapViewProps {
  progress: UserProgress;
  lessonsMap: Record<number, Lesson>;
  activeDay: number;
  nowMs: number;
  onSelectDay: (day: number) => void;
}

export const RoadmapView: React.FC<RoadmapViewProps> = ({
  progress,
  lessonsMap,
  activeDay,
  nowMs,
  onSelectDay,
}) => {
  const accuracy = calculateAccuracyPercent(progress);
  const unlockStatus = getNextUnlockStatus(progress, nowMs);
  const maxDayVisible = Math.max(7, progress.unlockedDay + 1);
  const daysList = Array.from({ length: maxDayVisible }, (_, i) => i + 1);

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Compact Stats Header */}
      <section className="grid grid-cols-3 gap-3">
        <div className="glass-surface rounded-2xl p-4 space-y-1">
          <p className="text-xs text-slate-400">Пройдено</p>
          <p className="text-2xl font-extrabold text-slate-50 tabular-nums">
            {progress.completedDays.length}
          </p>
        </div>
        <div className="glass-surface rounded-2xl p-4 space-y-1">
          <p className="text-xs text-slate-400">Серия</p>
          <p className="text-2xl font-extrabold text-sky-300 tabular-nums">
            {progress.streakDays} дн.
          </p>
        </div>
        <div className="glass-surface rounded-2xl p-4 space-y-1">
          <p className="text-xs text-slate-400">Точность</p>
          <p className="text-2xl font-extrabold text-violet-300 tabular-nums">
            {accuracy}%
          </p>
        </div>
      </section>

      {/* Curriculum List */}
      <section className="space-y-3" aria-label="Программа обучения">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-bold text-slate-100">Траектория обучения</h2>
          <span className="text-xs text-slate-400 tabular-nums">
            День {progress.unlockedDay} открыт
          </span>
        </div>

        <div className="space-y-2.5">
          {daysList.map((day) => {
            const lesson = lessonsMap[day];
            const isWeekly = isWeeklyReviewDay(day);
            const isCompleted = progress.completedDays.includes(day);
            const isUnlocked = day <= progress.unlockedDay;
            const isWaiting24h =
              !isUnlocked && day === unlockStatus.nextDay && unlockStatus.isTimeLocked;
            const isCurrent = day === activeDay;

            const title = isWeekly
              ? `Еженедельный срез знаний · Неделя ${Math.ceil(day / 7)}`
              : lesson
                ? lesson.topic
                : `Адаптивный ИИ-урок · День ${day}`;

            const subtitle = isWeekly
              ? 'Итоговый тест из 6 вопросов по темам недели'
              : day <= 5
                ? `${lesson?.category ?? 'Базовый модуль'} · Предустановлен`
                : 'Динамическая генерация через Gemini API';

            return (
              <button
                key={day}
                type="button"
                disabled={!isUnlocked}
                onClick={() => onSelectDay(day)}
                className={`w-full min-h-[68px] text-left rounded-2xl p-4 border transition-all flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'glass-surface-elevated border-sky-400/50'
                    : isUnlocked
                      ? 'glass-surface hover:border-slate-500/50'
                      : 'bg-slate-900/35 border-slate-800/60 opacity-75 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm tabular-nums ${
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : isUnlocked
                          ? isWeekly
                            ? 'bg-violet-500/20 text-violet-300 border border-violet-400/30'
                            : 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                          : 'bg-slate-800/80 text-slate-500 border border-slate-700/50'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : isWeekly ? (
                      <Award className="w-5 h-5" />
                    ) : isUnlocked ? (
                      day >= 6 ? (
                        <Sparkles className="w-4 h-4" />
                      ) : (
                        <BookOpen className="w-4 h-4" />
                      )
                    ) : (
                      <Lock className="w-4 h-4" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-300 tabular-nums">
                        День {day}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      {isCompleted ? (
                        <span className="text-emerald-400">Пройден</span>
                      ) : isUnlocked ? (
                        <span className="text-sky-300">Доступен</span>
                      ) : isWaiting24h ? (
                        <span className="text-amber-300 flex items-center gap-1 tabular-nums">
                          <Clock className="w-3 h-3" />
                          через {formatCountdown(unlockStatus.msRemaining)}
                        </span>
                      ) : (
                        <span className="text-slate-500">Заблокирован</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-100 truncate">
                      {title}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{subtitle}</p>
                  </div>
                </div>

                {isUnlocked && (
                  <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
