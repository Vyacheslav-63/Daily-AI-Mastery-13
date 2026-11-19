import React, { useState } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { WeeklyQuiz } from '../types/curriculum';
import { LessonSkeleton } from './LessonSkeleton';

interface WeeklyQuizViewProps {
  day: number;
  quiz: WeeklyQuiz | null;
  isLoading: boolean;
  error: string | null;
  isCompleted: boolean;
  onRetryLoad: () => void;
  onCompleteWeekly: (correctCount: number, totalCount: number) => void;
  onGoToRoadmap: () => void;
}

export const WeeklyQuizView: React.FC<WeeklyQuizViewProps> = ({
  day,
  quiz,
  isLoading,
  error,
  isCompleted,
  onRetryLoad,
  onCompleteWeekly,
  onGoToRoadmap,
}) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(isCompleted);

  if (isLoading) {
    return (
      <LessonSkeleton
        label={`Составление еженедельного среза знаний за Неделю ${Math.ceil(day / 7)}...`}
      />
    );
  }

  if (error || !quiz) {
    return (
      <div className="glass-surface rounded-3xl p-6 sm:p-8 space-y-4 animate-fade-up">
        <h2 className="text-xl font-bold text-slate-100">
          Не удалось загрузить срез знаний (День {day})
        </h2>
        <p className="text-sm text-rose-300 leading-relaxed">
          {error || 'Неизвестная ошибка обращения к Gemini API.'}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={onRetryLoad}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Повторить попытку</span>
          </button>
          <button
            type="button"
            onClick={onGoToRoadmap}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors"
          >
            К программе курса
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    const total = quiz.questions.length;
    const displayCorrect = isCompleted && correctCount === 0 ? total : correctCount;
    const pct = Math.round((displayCorrect / Math.max(1, total)) * 100);

    return (
      <section className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-6 text-center animate-fade-up">
        <div className="w-16 h-16 rounded-2xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center mx-auto text-violet-300">
          <Award className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-sky-300">
            День {day} · Еженедельный срез завершён
          </p>
          <h2 className="text-2xl font-bold text-slate-50">{quiz.title}</h2>
          <p className="text-sm text-slate-300 max-w-md mx-auto">
            {isCompleted
              ? 'Этот еженедельный срез уже засчитан в вашем профиле.'
              : `Вы правильно ответили на ${correctCount} из ${total} вопросов (${pct}%).`}
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToRoadmap}
          className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 transition-colors"
        >
          <span>Открыть программу курса</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>
    );
  }

  const currentQ = quiz.questions[currentIdx];
  const isLast = currentIdx === quiz.questions.length - 1;
  const isCurrentCorrect = selectedOption === currentQ.correct_answer;

  const handleConfirmAnswer = () => {
    if (!selectedOption || isAnswered) return;
    if (isCurrentCorrect) {
      setCorrectCount((prev) => prev + 1);
    }
    setIsAnswered(true);
  };

  const handleNext = () => {
    if (!isLast) {
      setCurrentIdx((prev) => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setFinished(true);
      onCompleteWeekly(correctCount, quiz.questions.length);
    }
  };

  return (
    <section
      aria-labelledby="weekly-quiz-title"
      className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-6 animate-fade-up"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
          <span className="text-violet-300 font-medium">
            День {day} · Неделя {quiz.weekNumber}
          </span>
          <span className="tabular-nums">
            Вопрос {currentIdx + 1} из {quiz.questions.length}
          </span>
        </div>

        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-400 to-violet-500 transition-all duration-300"
            style={{
              width: `${((currentIdx + (isAnswered ? 1 : 0)) / quiz.questions.length) * 100}%`,
            }}
          />
        </div>

        <p className="text-xs text-slate-400 pt-1">
          День {currentQ.day} · {currentQ.topic}
        </p>
        <h2
          id="weekly-quiz-title"
          className="text-xl sm:text-2xl font-bold text-slate-50 leading-snug text-balance"
        >
          {currentQ.question}
        </h2>
      </div>

      <div className="space-y-3" role="radiogroup" aria-label="Варианты ответа">
        {currentQ.options.map((opt, idx) => {
          const picked = selectedOption === opt;
          const correct = opt === currentQ.correct_answer;

          let cls =
            'bg-slate-900/60 border-slate-700/60 text-slate-200 hover:border-sky-400/50 hover:bg-slate-800/70';

          if (isAnswered) {
            if (correct) cls = 'bg-emerald-500/15 border-emerald-400/60 text-emerald-100';
            else if (picked) cls = 'bg-rose-500/15 border-rose-400/60 text-rose-100';
            else cls = 'bg-slate-900/40 border-slate-800/60 text-slate-400';
          } else if (picked) {
            cls = 'bg-sky-500/15 border-sky-400 text-sky-50';
          }

          return (
            <button
              key={idx}
              type="button"
              disabled={isAnswered}
              onClick={() => setSelectedOption(opt)}
              className={`w-full min-h-[52px] text-left px-4 py-3.5 rounded-2xl border text-sm leading-relaxed transition-all flex items-start justify-between gap-3 ${cls}`}
            >
              <span>{opt}</span>
              {isAnswered && correct && (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {isAnswered && picked && !correct && (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div
          className={`rounded-2xl p-4 text-sm border animate-fade-up ${
            isCurrentCorrect
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-100'
          }`}
        >
          <p className="font-semibold mb-1">
            {isCurrentCorrect ? 'Правильно!' : 'Обратите внимание:'}
          </p>
          <p className="text-slate-200 leading-relaxed">{currentQ.explanation}</p>
        </div>
      )}

      {!isAnswered ? (
        <button
          type="button"
          disabled={!selectedOption}
          onClick={handleConfirmAnswer}
          className="w-full min-h-[48px] rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition-colors"
        >
          Ответить
        </button>
      ) : (
        <button
          type="button"
          onClick={handleNext}
          className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          <span>{isLast ? 'Завершить еженедельный срез' : 'Следующий вопрос'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </section>
  );
};
