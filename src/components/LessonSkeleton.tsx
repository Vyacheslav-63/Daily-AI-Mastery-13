import React from 'react';

export const LessonSkeleton: React.FC<{ label?: string }> = ({
  label = 'Генерация персонального урока через Gemini...',
}) => {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="glass-surface rounded-2xl p-6 space-y-5 animate-fade-up"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-medium text-sky-300">{label}</span>
        <span className="text-xs text-slate-400 tabular-nums">JSON Schema</span>
      </div>
      <div className="space-y-3 animate-pulse">
        <div className="h-7 w-3/4 rounded-lg bg-slate-800/90" />
        <div className="h-4 w-1/3 rounded-md bg-slate-800/70" />
      </div>
      <div className="space-y-2.5 animate-pulse pt-2">
        <div className="h-4 w-full rounded bg-slate-800/80" />
        <div className="h-4 w-11/12 rounded bg-slate-800/80" />
        <div className="h-4 w-5/6 rounded bg-slate-800/80" />
      </div>
      <div className="h-28 w-full rounded-xl bg-slate-950/80 border border-slate-800/80 animate-pulse" />
      <div className="space-y-2.5 animate-pulse">
        <div className="h-4 w-full rounded bg-slate-800/70" />
        <div className="h-4 w-4/5 rounded bg-slate-800/70" />
      </div>
    </div>
  );
};

export const DeepDiveSkeleton: React.FC = () => {
  return (
    <div
      aria-busy="true"
      className="mt-6 rounded-2xl bg-slate-900/70 border border-violet-500/25 p-5 space-y-4 animate-fade-up"
    >
      <p className="text-xs font-medium text-violet-300">
        Подготовка углублённого технического разбора...
      </p>
      <div className="space-y-2 animate-pulse">
        <div className="h-4 w-full rounded bg-slate-800/85" />
        <div className="h-4 w-10/12 rounded bg-slate-800/85" />
        <div className="h-4 w-3/4 rounded bg-slate-800/85" />
      </div>
      <div className="h-24 w-full rounded-xl bg-slate-950/80 animate-pulse" />
    </div>
  );
};
