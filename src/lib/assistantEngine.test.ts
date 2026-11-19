import test from 'node:test';
import assert from 'node:assert/strict';
import { ONBOARDING_LESSONS } from '../data/onboardingLessons';
import { createInitialProgress } from './curriculumEngine';
import {
  buildAssistantSystemPrompt,
  computeMasteryProfile,
  parseAssistantReply,
} from './assistantEngine';
import type { Lesson } from '../types/curriculum';

const lessonsMap: Record<number, Lesson> = {};
for (const l of ONBOARDING_LESSONS) {
  lessonsMap[l.day] = l;
}

test('computeMasteryProfile starts at level 1 (Старт) on Day 1', () => {
  const progress = createInitialProgress('u1');
  const profile = computeMasteryProfile(progress, lessonsMap[1], lessonsMap);

  assert.equal(profile.level, 1);
  assert.equal(profile.label, 'Старт');
  assert.equal(profile.currentDay, 1);
  assert.equal(profile.completedTopics.length, 0);
  assert.equal(profile.suggestedPrompts.length, 3);
});

test('computeMasteryProfile advances to Практик, Инженер, and Архитектор as user progresses', () => {
  const base = createInitialProgress('u1');

  const level2 = computeMasteryProfile(
    { ...base, completedDays: [1, 2], unlockedDay: 3 },
    lessonsMap[3],
    lessonsMap
  );
  assert.equal(level2.level, 2);
  assert.equal(level2.label, 'Практик');
  assert.equal(level2.completedTopics.length, 2);

  const level3 = computeMasteryProfile(
    { ...base, completedDays: [1, 2, 3, 4], unlockedDay: 5 },
    lessonsMap[5],
    lessonsMap
  );
  assert.equal(level3.level, 3);
  assert.equal(level3.label, 'Инженер');

  const level4 = computeMasteryProfile(
    {
      ...base,
      completedDays: [1, 2, 3, 4, 5],
      unlockedDay: 6,
      correctAnswers: 9,
      totalAnswered: 10,
    },
    lessonsMap[5],
    lessonsMap
  );
  assert.equal(level4.level, 4);
  assert.equal(level4.label, 'Архитектор');
  assert.equal(level4.accuracyPercent, 90);
});

test('buildAssistantSystemPrompt embeds mastery level and completed topics', () => {
  const progress = {
    ...createInitialProgress('u1'),
    completedDays: [1, 2],
    unlockedDay: 3,
    correctAnswers: 2,
    totalAnswered: 2,
  };
  const profile = computeMasteryProfile(progress, lessonsMap[3], lessonsMap);
  const prompt = buildAssistantSystemPrompt(profile);

  assert.ok(prompt.includes('Уровень глубины: 2/4 (Практик)'));
  assert.ok(prompt.includes(lessonsMap[1].topic));
  assert.ok(prompt.includes(lessonsMap[3].topic));
  assert.ok(prompt.includes('100%'));
});

test('parseAssistantReply parses structured JSON response cleanly', () => {
  const reply = parseAssistantReply(
    JSON.stringify({
      answer: 'Краткий разбор SSE и retry-логики.',
      keyTakeaways: ['Используйте backoff с jitter', 'Ограничивайте таймаут'],
      codeSnippet: 'const delay = 500 * 2 ** attempt;',
      codeLanguage: 'typescript',
      nextDepthSuggestions: ['Как кэшировать промпты?', 'Как логировать токены?'],
    })
  );

  assert.equal(reply.answer, 'Краткий разбор SSE и retry-логики.');
  assert.equal(reply.keyTakeaways.length, 2);
  assert.equal(reply.codeSnippet, 'const delay = 500 * 2 ** attempt;');
  assert.equal(reply.codeLanguage, 'typescript');
  assert.equal(reply.nextDepthSuggestions.length, 2);
});

test('parseAssistantReply gracefully handles plain text fallback', () => {
  const reply = parseAssistantReply('Обычный текстовый ответ без JSON.');
  assert.equal(reply.answer, 'Обычный текстовый ответ без JSON.');
  assert.ok(reply.nextDepthSuggestions.length >= 2);
});
