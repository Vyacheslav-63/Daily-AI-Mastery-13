import type { Lesson, UserProgress, WeeklyQuiz } from '../types/curriculum';

export const DAY_UNLOCK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function createInitialProgress(uid = 'local-guest'): UserProgress {
  return {
    uid,
    unlockedDay: 1,
    completedDays: [],
    lastCompletedAt: 0,
    correctAnswers: 0,
    totalAnswered: 0,
    streakDays: 0,
    gatePassedForDay: 1,
    fastTrackMode: false,
  };
}

/**
 * Checks whether a target day is a Weekly Synthesis Quiz day (every 7th day).
 */
export function isWeeklyReviewDay(day: number): boolean {
  return day > 0 && day % 7 === 0;
}

/**
 * Returns the week index (1-based) for a given day number.
 */
export function getWeekNumber(day: number): number {
  return Math.max(1, Math.ceil(day / 7));
}

/**
 * Calculates whether the next day (after the latest completed day) is currently unlocked
 * by the 24-hour drip schedule, and how many milliseconds remain if locked.
 */
export function getNextUnlockStatus(
  progress: UserProgress,
  nowMs: number = Date.now()
): {
  nextDay: number;
  isTimeLocked: boolean;
  msRemaining: number;
  canUnlockNow: boolean;
} {
  const maxCompleted =
    progress.completedDays.length > 0 ? Math.max(...progress.completedDays) : 0;
  const nextDay = Math.max(progress.unlockedDay, maxCompleted + 1);

  // Day 1 is always unlocked
  if (maxCompleted === 0) {
    return {
      nextDay: 1,
      isTimeLocked: false,
      msRemaining: 0,
      canUnlockNow: false,
    };
  }

  // If unlockedDay has already advanced past maxCompleted (e.g., already unlocked), not locked
  if (progress.unlockedDay > maxCompleted) {
    return {
      nextDay: progress.unlockedDay,
      isTimeLocked: false,
      msRemaining: 0,
      canUnlockNow: false,
    };
  }

  if (progress.fastTrackMode) {
    return {
      nextDay,
      isTimeLocked: false,
      msRemaining: 0,
      canUnlockNow: true,
    };
  }

  const unlockAt = progress.lastCompletedAt + DAY_UNLOCK_INTERVAL_MS;
  const msRemaining = Math.max(0, unlockAt - nowMs);
  const isTimeLocked = progress.lastCompletedAt > 0 && msRemaining > 0;

  return {
    nextDay,
    isTimeLocked,
    msRemaining,
    canUnlockNow: !isTimeLocked,
  };
}

/**
 * Synchronizes unlockedDay if 24h has passed or fastTrackMode is enabled.
 */
export function resolveEffectiveProgress(
  progress: UserProgress,
  nowMs: number = Date.now()
): UserProgress {
  const status = getNextUnlockStatus(progress, nowMs);
  if (status.canUnlockNow && status.nextDay > progress.unlockedDay) {
    return {
      ...progress,
      unlockedDay: status.nextDay,
    };
  }
  return progress;
}

/**
 * Determines whether the user must pass yesterday's 1-question check before reading `activeDay`.
 * Day 1 has no previous day. Weekly review days (Day 7, 14, ...) are themselves quizzes.
 */
export function requiresDailyGateQuiz(
  progress: UserProgress,
  activeDay: number
): boolean {
  if (activeDay <= 1) return false;
  if (isWeeklyReviewDay(activeDay)) return false;
  if (progress.completedDays.includes(activeDay)) return false;
  return progress.gatePassedForDay < activeDay;
}

/**
 * Records the answer to a single daily gate question and unlocks `activeDay` content.
 */
export function applyDailyGateAnswer(
  progress: UserProgress,
  activeDay: number,
  isCorrect: boolean
): UserProgress {
  return {
    ...progress,
    correctAnswers: progress.correctAnswers + (isCorrect ? 1 : 0),
    totalAnswered: progress.totalAnswered + 1,
    gatePassedForDay: Math.max(progress.gatePassedForDay, activeDay),
  };
}

/**
 * Marks a regular lesson day as completed. If fastTrackMode is enabled, immediately unlocks day + 1.
 * Otherwise sets lastCompletedAt to nowMs so day + 1 opens in 24 hours.
 */
export function completeLessonDay(
  progress: UserProgress,
  day: number,
  nowMs: number = Date.now()
): UserProgress {
  const alreadyCompleted = progress.completedDays.includes(day);
  const completedDays = alreadyCompleted
    ? progress.completedDays
    : [...progress.completedDays, day].sort((a, b) => a - b);

  const nextUnlocked = progress.fastTrackMode
    ? Math.max(progress.unlockedDay, day + 1)
    : progress.unlockedDay;

  return {
    ...progress,
    completedDays,
    unlockedDay: nextUnlocked,
    lastCompletedAt: alreadyCompleted ? progress.lastCompletedAt : nowMs,
    streakDays: alreadyCompleted ? progress.streakDays : progress.streakDays + 1,
  };
}

/**
 * Records completion of a Day 7 (or 7*k) weekly review quiz.
 */
export function completeWeeklyQuiz(
  progress: UserProgress,
  day: number,
  correctCount: number,
  totalCount: number,
  nowMs: number = Date.now()
): UserProgress {
  const alreadyCompleted = progress.completedDays.includes(day);
  const completedDays = alreadyCompleted
    ? progress.completedDays
    : [...progress.completedDays, day].sort((a, b) => a - b);

  const nextUnlocked = progress.fastTrackMode
    ? Math.max(progress.unlockedDay, day + 1)
    : progress.unlockedDay;

  return {
    ...progress,
    completedDays,
    unlockedDay: nextUnlocked,
    lastCompletedAt: alreadyCompleted ? progress.lastCompletedAt : nowMs,
    correctAnswers: progress.correctAnswers + correctCount,
    totalAnswered: progress.totalAnswered + totalCount,
    streakDays: alreadyCompleted ? progress.streakDays : progress.streakDays + 1,
    gatePassedForDay: Math.max(progress.gatePassedForDay, day + 1),
  };
}

export function calculateAccuracyPercent(progress: UserProgress): number {
  if (progress.totalAnswered <= 0) return 0;
  return Math.round((progress.correctAnswers / progress.totalAnswered) * 100);
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Validates and normalizes JSON output returned by Gemini for a generated lesson.
 */
export function parseGeneratedLessonPayload(rawJson: string, day: number): Lesson {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : '';
  const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
  const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const correctAnswer =
    typeof parsed.correct_answer === 'string' ? parsed.correct_answer.trim() : '';
  const rawOptions = Array.isArray(parsed.options)
    ? parsed.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!topic || !content || !question || rawOptions.length < 4 || !correctAnswer) {
    throw new Error('Модель вернула неполную структуру урока.');
  }

  const normalizedOptions = rawOptions.slice(0, 4) as [string, string, string, string];
  if (!normalizedOptions.includes(correctAnswer)) {
    normalizedOptions[0] = correctAnswer;
  }

  return {
    day,
    topic,
    category:
      typeof parsed.category === 'string' && parsed.category.trim()
        ? parsed.category.trim()
        : 'AI Инженерия',
    readMinutes:
      typeof parsed.readMinutes === 'number' && parsed.readMinutes > 0
        ? Math.round(parsed.readMinutes)
        : 5,
    content,
    codeExample:
      typeof parsed.code_example === 'string' && parsed.code_example.trim()
        ? parsed.code_example.trim()
        : undefined,
    codeLanguage:
      typeof parsed.code_language === 'string' && parsed.code_language.trim()
        ? parsed.code_language.trim()
        : 'typescript',
    question,
    options: normalizedOptions,
    correct_answer: correctAnswer,
    explanation:
      typeof parsed.explanation === 'string' && parsed.explanation.trim()
        ? parsed.explanation.trim()
        : 'Правильный ответ закрепляет ключевой принцип архитектуры ИИ-систем.',
    isPreinstalled: false,
  };
}

export function parseWeeklyQuizPayload(rawJson: string, day: number): WeeklyQuiz {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (rawQuestions.length === 0) {
    throw new Error('Не удалось сформировать вопросы еженедельного среза.');
  }

  const questions = rawQuestions.slice(0, 6).map((item, idx) => {
    const q = item as Record<string, unknown>;
    const opts = Array.isArray(q.options)
      ? q.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : [];
    const correct =
      typeof q.correct_answer === 'string' && q.correct_answer.trim()
        ? q.correct_answer.trim()
        : opts[0] ?? 'Вариант A';
    const normalizedOpts: [string, string, string, string] = [
      opts[0] ?? correct,
      opts[1] ?? 'Альтернативный подход',
      opts[2] ?? 'Устаревший паттерн',
      opts[3] ?? 'Неверный вариант',
    ];
    if (!normalizedOpts.includes(correct)) {
      normalizedOpts[0] = correct;
    }

    return {
      day: typeof q.day === 'number' ? q.day : day - 6 + idx,
      topic: typeof q.topic === 'string' && q.topic.trim() ? q.topic.trim() : `День ${day - 6 + idx}`,
      question:
        typeof q.question === 'string' && q.question.trim()
          ? q.question.trim()
          : 'Какой архитектурный принцип является ключевым для данной темы?',
      options: normalizedOpts,
      correct_answer: correct,
      explanation:
        typeof q.explanation === 'string' && q.explanation.trim()
          ? q.explanation.trim()
          : 'Этот ответ соответствует лучшим практикам построения ИИ-инфраструктуры.',
    };
  });

  return {
    weekNumber: getWeekNumber(day),
    day,
    title:
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : `Еженедельный срез · Неделя ${getWeekNumber(day)}`,
    questions,
  };
}
