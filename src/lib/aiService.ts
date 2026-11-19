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
export const PRIMARY_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

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

export class GeminiHttpError extends Error {
  readonly status: number;
  readonly rawBody: string;

  constructor(status: number, message: string, rawBody = '') {
    super(message);
    this.name = 'GeminiHttpError';
    this.status = status;
    this.rawBody = rawBody;
  }
}

/**
 * Pure helper: turns raw Gemini REST HTTP error bodies into clear, actionable
 * Russian messages instead of leaking truncated JSON payloads.
 */
export function formatGeminiDirectError(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<HTML')
  ) {
    return `Прямой запрос к Gemini заблокирован или прокси вернул HTML (HTTP ${status}). Проверьте Proxy URL в Настройках.`;
  }

  let apiMessage = '';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string } };
    if (typeof parsed?.error?.message === 'string') {
      apiMessage = parsed.error.message;
    }
  } catch {
    apiMessage = trimmed.slice(0, 160);
  }

  const lower = apiMessage.toLowerCase();

  if (status === 503 || lower.includes('high demand') || lower.includes('overloaded')) {
    return 'Серверы Gemini сейчас временно перегружены (503). Мы автоматически повторили запрос и попробовали резервную модель — попробуйте ещё раз через 10–15 секунд.';
  }

  if (status === 429 || lower.includes('quota') || lower.includes('rate limit')) {
    const retryMatch = apiMessage.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
    const waitHint = retryMatch
      ? ` Подождите около ${Math.ceil(Number(retryMatch[1]))} сек.`
      : ' Подождите 30–60 секунд перед следующим запросом.';
    return `Достигнут лимит запросов бесплатного тарифа Gemini API (429).${waitHint} Если ошибка повторяется весь день — проверьте суточную квоту ключа в Google AI Studio.`;
  }

  if (lower.includes('location is not supported') || lower.includes('region')) {
    return 'Прямой доступ к Gemini API ограничен в вашем регионе. Укажите адрес Cloudflare Worker в поле Proxy URL в разделе «Настройки».';
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api key not valid') ||
    lower.includes('api_key_invalid')
  ) {
    return 'Неверный или отозванный Gemini API-ключ. Проверьте ключ в разделе «Настройки».';
  }

  return `Ошибка Gemini API (HTTP ${status}): ${apiMessage.slice(0, 160) || 'повторите попытку позже.'}`;
}

/**
 * Pure helper: runs a Gemini model call with exponential backoff on 503/429
 * and automatic fallback from gemini-4-hydrogen to gemini-3.1-flash-lite.
 */
export async function executeWithModelFallback<T>(
  runner: (model: string) => Promise<T>,
  options?: {
    sleep?: (ms: number) => Promise<void>;
    baseDelayMs?: number;
  }
): Promise<T> {
  const sleep =
    options?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseDelayMs = options?.baseDelayMs ?? 700;

  const isTransient = (err: unknown): number | null => {
    const status = (err as { status?: number })?.status;
    if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
      return status;
    }
    return null;
  };

  // 1. Primary model (gemini-4-hydrogen)
  try {
    return await runner(PRIMARY_MODEL);
  } catch (firstErr) {
    const status = isTransient(firstErr);
    if (!status) throw firstErr;

    // On 503/5xx (temporary spike), do 1 quick retry on primary before falling back;
    // on 429 (model quota/RPM limit), switch immediately to the separate lite quota.
    if (status !== 429) {
      await sleep(baseDelayMs + Math.floor(Math.random() * 250));
      try {
        return await runner(PRIMARY_MODEL);
      } catch (retryErr) {
        if (!isTransient(retryErr)) throw retryErr;
      }
    }
  }

  // 2. Fallback model (gemini-3.1-flash-lite — higher free-tier limits & lower load)
  try {
    return await runner(FALLBACK_MODEL);
  } catch (fallbackErr) {
    const status = isTransient(fallbackErr);
    if (!status) throw fallbackErr;

    await sleep(baseDelayMs * 2 + Math.floor(Math.random() * 300));
    return await runner(FALLBACK_MODEL);
  }
}

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
 * Shared direct Gemini REST caller with automatic 503/429 retry + fallback to
 * gemini-3.1-flash-lite. Personal API keys stay strictly on the user's device.
 */
async function callDirectGeminiContents(
  settings: UserSettings,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  systemInstruction: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  const baseUrl = normalizeBaseUrl(settings.customBaseUrl);
  const apiKey = settings.customApiKey.trim();

  return executeWithModelFallback(async (model) => {
    const endpoint = `${baseUrl}/v1beta/models/${model}:generateContent`;
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseSchema,
    };
    if (model === PRIMARY_MODEL) {
      generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig,
      }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new GeminiHttpError(
        response.status,
        formatGeminiDirectError(response.status, bodyText),
        bodyText
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
      throw new Error('Модель Gemini вернула пустой ответ.');
    }
    return text;
  });
}

async function callDirectGeminiRest(
  settings: UserSettings,
  prompt: string,
  systemInstruction: string,
  responseSchema: Record<string, unknown>
): Promise<string> {
  return callDirectGeminiContents(
    settings,
    [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction,
    responseSchema
  );
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
  // Keep recent context compact to preserve free-tier token-per-minute (TPM) quota
  const trimmedHistory = params.history.slice(-6).map((item) => ({
    role: item.role,
    text: item.text.slice(0, 1200),
  }));

  if (params.settings.customApiKey.trim()) {
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
        parts: [{ text: item.text }],
      })),
      { role: 'user', parts: [{ text: params.message.trim().slice(0, 1500) }] },
    ];

    const text = await callDirectGeminiContents(
      params.settings,
      contents,
      systemPrompt,
      schema
    );
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
