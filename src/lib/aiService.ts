import type { DeepDiveData, Lesson, UserSettings, WeeklyQuiz } from '../types/curriculum';
import { parseGeneratedLessonPayload, parseWeeklyQuizPayload } from './curriculumEngine';

const DEFAULT_DIRECT_BASE = 'https://generativelanguage.googleapis.com';
const MODEL_NAME = 'gemini-4-hydrogen';

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_DIRECT_BASE;
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * When the user supplies their own Gemini API key in Settings, requests go directly
 * from the browser to the user's chosen Base URL (or official Gemini REST endpoint)
 * so the personal key never leaves the device to the developer's server.
 */
async function callDirectGeminiRest(
  settings: UserSettings,
  prompt: string,
  systemInstruction: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  const baseUrl = normalizeBaseUrl(settings.customBaseUrl);
  const endpoint = `${baseUrl}/v1beta/models/${MODEL_NAME}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.customApiKey.trim(),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Ошибка прямого запроса (${response.status}): ${errText.slice(0, 180) || response.statusText}`
    );
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Прокси вернул пустой ответ от модели Gemini.');
  }
  return text;
}

export async function generateDynamicLesson(
  day: number,
  previousTopics: string[],
  settings: UserSettings
): Promise<Lesson> {
  if (settings.customApiKey.trim()) {
    const prompt = `Ты — ведущий архитектор ИИ-систем и преподаватель курса «Daily AI Mastery».
Сгенерируй структурированный технический микро-урок на русском языке для Дня ${day}.
Предыдущие изученные темы: ${previousTopics.join(' | ')}.
Стиль: практичный, 3–4 абзаца + короткий рабочий пример кода + 1 проверочный вопрос с 4 вариантами ответа.`;

    const schema = {
      type: 'OBJECT',
      properties: {
        topic: { type: 'STRING' },
        category: { type: 'STRING' },
        readMinutes: { type: 'INTEGER' },
        content: { type: 'STRING' },
        code_example: { type: 'STRING' },
        code_language: { type: 'STRING' },
        question: { type: 'STRING' },
        options: { type: 'ARRAY', items: { type: 'STRING' } },
        correct_answer: { type: 'STRING' },
        explanation: { type: 'STRING' },
      },
      required: [
        'topic',
        'category',
        'readMinutes',
        'content',
        'code_example',
        'code_language',
        'question',
        'options',
        'correct_answer',
        'explanation',
      ],
    };

    const raw = await callDirectGeminiRest(
      settings,
      prompt,
      'Отвечай строго валидным JSON на русском языке согласно схеме.',
      schema
    );
    return parseGeneratedLessonPayload(raw, day);
  }

  const response = await fetch('/api/lessons/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, previousTopics }),
  });

  const data = (await response.json()) as { raw?: string; error?: string };
  if (!response.ok || !data.raw) {
    throw new Error(data.error || 'Не удалось сгенерировать урок.');
  }
  return parseGeneratedLessonPayload(data.raw, day);
}

export async function generateDeepDive(
  topic: string,
  content: string,
  settings: UserSettings
): Promise<DeepDiveData> {
  let raw: string;

  if (settings.customApiKey.trim()) {
    const prompt = `Пользователь изучает урок «${topic}».
Содержание: ${content.slice(0, 3500)}
Сформируй углублённый технический разбор (Deep Dive) уровня Senior AI Engineer на русском языке: overview (2-3 абзаца), code (production-ready пример), language, tips (массив из 3-4 инженерных чек-поинтов).`;
    const schema = {
      type: 'OBJECT',
      properties: {
        overview: { type: 'STRING' },
        code: { type: 'STRING' },
        language: { type: 'STRING' },
        tips: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['overview', 'code', 'language', 'tips'],
    };
    raw = await callDirectGeminiRest(
      settings,
      prompt,
      'Отвечай строго валидным JSON согласно схеме.',
      schema
    );
  } else {
    const response = await fetch('/api/lessons/deep-dive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, content }),
    });
    const data = (await response.json()) as { raw?: string; error?: string };
    if (!response.ok || !data.raw) {
      throw new Error(data.error || 'Не удалось выполнить Deep Dive.');
    }
    raw = data.raw;
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const overview = typeof parsed.overview === 'string' ? parsed.overview.trim() : '';
  if (!overview) {
    throw new Error('Ответ Deep Dive не содержит технического описания.');
  }

  return {
    overview,
    code: typeof parsed.code === 'string' ? parsed.code.trim() : '',
    language: typeof parsed.language === 'string' ? parsed.language.trim() : 'typescript',
    tips: Array.isArray(parsed.tips)
      ? parsed.tips.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [],
  };
}

export async function generateWeeklyQuiz(
  day: number,
  coveredLessons: Array<{ day: number; topic: string }>,
  settings: UserSettings
): Promise<WeeklyQuiz> {
  if (settings.customApiKey.trim()) {
    const summary = coveredLessons.map((l) => `День ${l.day}: ${l.topic}`).join('\n');
    const prompt = `Сформируй еженедельный срез знаний (День ${day}) из 6 вопросов по темам:\n${summary}`;
    const schema = {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              day: { type: 'INTEGER' },
              topic: { type: 'STRING' },
              question: { type: 'STRING' },
              options: { type: 'ARRAY', items: { type: 'STRING' } },
              correct_answer: { type: 'STRING' },
              explanation: { type: 'STRING' },
            },
            required: ['day', 'topic', 'question', 'options', 'correct_answer', 'explanation'],
          },
        },
      },
      required: ['title', 'questions'],
    };
    const raw = await callDirectGeminiRest(
      settings,
      prompt,
      'Отвечай строго валидным JSON на русском языке.',
      schema
    );
    return parseWeeklyQuizPayload(raw, day);
  }

  const response = await fetch('/api/lessons/weekly-quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, coveredLessons }),
  });
  const data = (await response.json()) as { raw?: string; error?: string };
  if (!response.ok || !data.raw) {
    throw new Error(data.error || 'Не удалось сгенерировать еженедельный срез.');
  }
  return parseWeeklyQuizPayload(data.raw, day);
}
