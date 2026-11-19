import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { Lesson } from '../types/curriculum';

interface DailyGateQuizProps {
  targetDay: number;
  previousLesson: Lesson;
  onComplete: (isCorrect: boolean) => void;
}

export const DailyGateQuiz: React.FC<DailyGateQuizProps> = ({
  targetDay,
  previousLesson,
  onComplete,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const isCorrect = selected === previousLesson.correct_answer;

  const handleSubmit = () => {
    if (!selected || submitted) return;
    setSubmitted(true);
  };

  return (
    <section
      aria-labelledby="gate-quiz-heading"
      className="glass-surface-elevated rounded-3xl p-6 sm:p-8 space-y-6 animate-fade-up"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-sky-300">
          <HelpCircle className="w-4 h-4 shrink-0" />
          <span>Проверка знаний перед Днём {targetDay}</span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-400">Материал Дня {previousLesson.day}</span>
        </div>
        <h2
          id="gate-quiz-heading"
          className="text-xl sm:text-2xl font-bold text-slate-50 leading-snug text-balance"
        >
          {previousLesson.question}
        </h2>
        <p className="text-xs text-slate-400">
          Тема вчерашнего урока: {previousLesson.topic}
        </p>
      </div>

      <div className="space-y-3" role="radiogroup" aria-label="Варианты ответа">
        {previousLesson.options.map((option, idx) => {
          const isPicked = selected === option;
          const isOptionCorrect = option === previousLesson.correct_answer;

          let style =
            'bg-slate-900/60 border-slate-700/60 text-slate-200 hover:border-sky-400/50 hover:bg-slate-800/70';

          if (submitted) {
            if (isOptionCorrect) {
              style = 'bg-emerald-500/15 border-emerald-400/60 text-emerald-100';
            } else if (isPicked && !isOptionCorrect) {
              style = 'bg-rose-500/15 border-rose-400/60 text-rose-100';
            } else {
              style = 'bg-slate-900/40 border-slate-800/60 text-slate-400';
            }
          } else if (isPicked) {
            style = 'bg-sky-500/15 border-sky-400 text-sky-50';
          }

          return (
            <button
              key={idx}
              type="button"
              disabled={submitted}
              onClick={() => setSelected(option)}
              className={`w-full min-h-[52px] text-left px-4 py-3.5 rounded-2xl border text-sm leading-relaxed transition-all flex items-start justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${style}`}
            >
              <span>{option}</span>
              {submitted && isOptionCorrect && (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {submitted && isPicked && !isOptionCorrect && (
                <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div
          className={`rounded-2xl p-4 text-sm leading-relaxed border animate-fade-up ${
            isCorrect
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-100'
          }`}
        >
          <p className="font-semibold mb-1">
            {isCorrect ? 'Верно! Отличное закрепление.' : 'Не совсем так — разберём нюанс:'}
          </p>
          <p className="text-slate-200">{previousLesson.explanation}</p>
        </div>
      )}

      {!submitted ? (
        <button
          type="button"
          disabled={!selected}
          onClick={handleSubmit}
          className="w-full min-h-[48px] rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <span>Проверить ответ</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onComplete(isCorrect)}
          className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 hover:from-sky-400 hover:to-violet-400 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-500/15"
        >
          <span>Открыть урок Дня {targetDay}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </section>
  );
};
