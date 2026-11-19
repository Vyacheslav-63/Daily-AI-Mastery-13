import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_UNLOCK_INTERVAL_MS,
  applyDailyGateAnswer,
  calculateAccuracyPercent,
  completeLessonDay,
  completeWeeklyQuiz,
  createInitialProgress,
  formatCountdown,
  getNextUnlockStatus,
  isWeeklyReviewDay,
  parseGeneratedLessonPayload,
  parseWeeklyQuizPayload,
  requiresDailyGateQuiz,
  resolveEffectiveProgress,
} from './curriculumEngine';

test('initial progress starts on Day 1 without gate quiz required', () => {
  const progress = createInitialProgress('user-1');
  assert.equal(progress.unlockedDay, 1);
  assert.equal(requiresDailyGateQuiz(progress, 1), false);
  assert.equal(calculateAccuracyPercent(progress), 0);
});

test('24-hour unlock gate locks Day 2 immediately after completing Day 1, and unlocks after 24h', () => {
  const t0 = 1_700_000_000_000;
  let progress = createInitialProgress();
  progress = completeLessonDay(progress, 1, t0);

  assert.deepEqual(progress.completedDays, [1]);
  assert.equal(progress.streakDays, 1);

  const lockedStatus = getNextUnlockStatus(progress, t0 + 60_000);
  assert.equal(lockedStatus.isTimeLocked, true);
  assert.equal(lockedStatus.nextDay, 2);
  assert.equal(lockedStatus.msRemaining, DAY_UNLOCK_INTERVAL_MS - 60_000);

  const unlockedStatus = getNextUnlockStatus(progress, t0 + DAY_UNLOCK_INTERVAL_MS + 1);
  assert.equal(unlockedStatus.isTimeLocked, false);
  assert.equal(unlockedStatus.canUnlockNow, true);

  const resolved = resolveEffectiveProgress(progress, t0 + DAY_UNLOCK_INTERVAL_MS + 1);
  assert.equal(resolved.unlockedDay, 2);
  assert.equal(requiresDailyGateQuiz(resolved, 2), true);
});

test('fastTrackMode unlocks next day immediately on completion', () => {
  const t0 = 1_700_000_000_000;
  let progress = { ...createInitialProgress(), fastTrackMode: true };
  progress = completeLessonDay(progress, 1, t0);
  assert.equal(progress.unlockedDay, 2);
  assert.equal(requiresDailyGateQuiz(progress, 2), true);

  progress = applyDailyGateAnswer(progress, 2, true);
  assert.equal(progress.correctAnswers, 1);
  assert.equal(progress.totalAnswered, 1);
  assert.equal(requiresDailyGateQuiz(progress, 2), false);
  assert.equal(calculateAccuracyPercent(progress), 100);
});

test('Day 7 is detected as weekly review day and skips daily gate quiz', () => {
  assert.equal(isWeeklyReviewDay(6), false);
  assert.equal(isWeeklyReviewDay(7), true);
  assert.equal(isWeeklyReviewDay(14), true);

  const progress = { ...createInitialProgress(), unlockedDay: 7, completedDays: [1, 2, 3, 4, 5, 6] };
  assert.equal(requiresDailyGateQuiz(progress, 7), false);

  const afterWeekly = completeWeeklyQuiz(progress, 7, 5, 6, 1_700_000_000_000);
  assert.equal(afterWeekly.correctAnswers, 5);
  assert.equal(afterWeekly.totalAnswered, 6);
  assert.ok(afterWeekly.completedDays.includes(7));
});

test('formatCountdown formats hours, minutes, seconds with zero padding', () => {
  assert.equal(formatCountdown(0), '00:00:00');
  assert.equal(formatCountdown(3661 * 1000), '01:01:01');
});

test('parseGeneratedLessonPayload validates required schema fields and repairs missing correct_answer in options', () => {
  const validJson = JSON.stringify({
    topic: 'RAG и векторные базы',
    category: 'RAG',
    readMinutes: 6,
    content: 'Подробный разбор RAG...',
    code_example: 'const vec = await embed(text);',
    code_language: 'typescript',
    question: 'Что хранится в векторной базе?',
    options: ['Эмбеддинги фрагментов текста', 'Только PNG', 'Пароли', 'Логи DNS'],
    correct_answer: 'Эмбеддинги фрагментов текста',
    explanation: 'Векторные базы индексируют числовые представления текста.',
  });

  const lesson = parseGeneratedLessonPayload(validJson, 6);
  assert.equal(lesson.day, 6);
  assert.equal(lesson.topic, 'RAG и векторные базы');
  assert.equal(lesson.options.length, 4);
  assert.equal(lesson.isPreinstalled, false);

  assert.throws(() => parseGeneratedLessonPayload('{"topic":""}', 6));
});

test('parseWeeklyQuizPayload parses 6 synthesis questions cleanly', () => {
  const raw = JSON.stringify({
    title: 'Срез Недели 1',
    questions: [1, 2, 3, 4, 5, 6].map((d) => ({
      day: d,
      topic: `Тема ${d}`,
      question: `Вопрос ${d}?`,
      options: ['A', 'B', 'C', 'D'],
      correct_answer: 'A',
      explanation: 'Объяснение',
    })),
  });
  const quiz = parseWeeklyQuizPayload(raw, 7);
  assert.equal(quiz.weekNumber, 1);
  assert.equal(quiz.questions.length, 6);
});
