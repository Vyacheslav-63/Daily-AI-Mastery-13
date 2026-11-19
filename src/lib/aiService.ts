import type {
  AssistantReply,
  DeepDiveData,
  Lesson,
  MasteryProfile,
  UserSettings,
  WeeklyQuiz,
} from '../types/curriculum';
import { buildAssistantSystemPrompt, parseAssistantReply } from './assistantEngine';
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

export const STATIC_HOSTING_API_ERROR =
  'Серверный API (/api) недоступен на статическом хостинге (например, Netlify). Откройте раздел «Настройки» и укажите свой бесплатный Gemini API-ключ — он хранится только на вашем устройстве, и Deep Dive заработает напрямую.';

/**
 * Pure helper: safely parses JSON from a fetch response body and detects HTML
 * fallbacks (such as Netlify SPA 200 index.html redirects or proxy error pages)
 * before JSON.parse throws "Unexpected token '<'".
 */
export function parseJsonResponseText<T>(
  text: string,
  contentType: string | null,
  status: number,
  context: 'backend' | 'direct',
  fallbackMessage: string
): T {
  const trimmed = text.trim();
  const isHtml =
    (contentType !== null && contentType.toLowerCase().includes('text/html')) ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML');

  if (isHtml || (context === 'backend' && (status === 404 || status === 405))) {
    if (context === 'backend') {
      throw new Error(STATIC_HOSTING_API_ERROR);
    }
    throw new Error(
      `Прокси или сервер вернул HTML-страницу вместо JSON (HTTP ${status}). Проверьте Proxy URL в Настройках или доступность API в вашей сети.`
    );
  }

  if (!trimmed) {
    throw new Error(`${fallbackMessage} (пустой ответ, HTTP ${status}).`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `${fallbackMessage} (некорректный формат ответа, HTTP ${status}).`
    );
  }
}

async function fetchBackendRawJson(
  endpoint: string,
  body: Record<string, unknown>,
  fallbackMessage: string
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = parseJsonResponseText<{ raw?: string; error?: string }>(
    text,
    response.headers.get('content-type'),
    response.status,
    'backend',
    fallbackMessage
  );

  if (!response.ok || !data.raw) {
    throw new Error(data.error || fallbackMessage);
  }

  return data.raw;
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

  const bodyText = await response.text();
  if (!response.ok) {
    const trimmed = bodyText.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      throw new Error(
        `Прямой запрос к Gemini заблокирован или прокси вернул HTML (HTTP ${response.status}). Проверьте Proxy URL в Настройках.`
      );
    }
    throw new Error(
      `Ошибка прямого запроса (${response.status}): ${trimmed.slice(0, 180) || response.statusText}`
    );
  }

  const json = parseJsonResponseText<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>(
    bodyText,
    response.headers.get('content-type'),
    response.status,
    'direct',
    'Не удалось разобрать ответ от Gemini API'
  );

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

  const raw = await fetchBackendRawJson(
    '/api/lessons/generate',
    { day, previousTopics },
    'Не удалось сгенерировать урок.'
  );
  return parseGeneratedLessonPayload(raw, day);
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
    raw = await fetchBackendRawJson(
      '/api/lessons/deep-dive',
      { topic, content },
      'Не удалось выполнить Deep Dive.'
    );
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

  const raw = await fetchBackendRawJson(
    '/api/lessons/weekly-quiz',
    { day, coveredLessons },
    'Не удалось сгенерировать еженедельный срез.'
  );
  return parseWeeklyQuizPayload(raw, day);
}

export async function askAdaptiveAssistant(params: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  profile: MasteryProfile;
  settings: UserSettings;
}): Promise<AssistantReply> {
  const systemPrompt = buildAssistantSystemPrompt(params.profile);
  const trimmedHistory = params.history.slice(-8);

  if (params.settings.customApiKey.trim()) {
    const baseUrl = normalizeBaseUrl(params.settings.customBaseUrl);
    const endpoint = `${baseUrl}/v1beta/models/${MODEL_NAME}:generateContent`;

    const schema = {
      type: 'OBJECT',
      properties: {
        answer: { type: 'STRING' },
        keyTakeaways: { type: 'ARRAY', items: { type: 'STRING' } },
        codeSnippet: { type: 'STRING' },
        codeLanguage: { type: 'STRING' },
        nextDepthSuggestions: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['answer', 'keyTakeaways', 'nextDepthSuggestions'],
    };

    const contents = [
      ...trimmedHistory.map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.text.slice(0, 1800) }],
      })),
      { role: 'user', parts: [{ text: params.message.trim().slice(0, 1500) }] },
    ];

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.settings.customApiKey.trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      const trimmed = bodyText.trim();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
        throw new Error(
          `Прямой запрос к Gemini заблокирован или прокси вернул HTML (HTTP ${response.status}). Проверьте Proxy URL в Настройках.`
        );
      }
      throw new Error(
        `Ошибка прямого запроса (${response.status}): ${trimmed.slice(0, 180) || response.statusText}`
      );
    }

    const json = parseJsonResponseText<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      bodyText,
      response.headers.get('content-type'),
      response.status,
      'direct',
      'Не удалось разобрать ответ ИИ-ассистента'
    );

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Модель Gemini вернула пустой ответ.');
    }
    return parseAssistantReply(text);
  }

  const raw = await fetchBackendRawJson(
    '/api/assistant/chat',
    {
      message: params.message,
      history: trimmedHistory,
      systemPrompt,
    },
    'Не удалось получить ответ ИИ-ассистента.'
  );
  return parseAssistantReply(raw);
}
