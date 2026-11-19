import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import * as webpushNamespace from 'web-push';
import type { PushSubscription } from 'web-push';

const webpush =
  (webpushNamespace as unknown as { default?: typeof webpushNamespace }).default ??
  webpushNamespace;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite';

// VAPID configuration for PWA Web Push
const vapidKeys =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? {
        publicKey: process.env.VAPID_PUBLIC_KEY,
        privateKey: process.env.VAPID_PRIVATE_KEY,
      }
    : webpush.generateVAPIDKeys();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:noreply@daily-ai-mastery.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const pushSubscriptions = new Map<string, PushSubscription>();
const scheduledPushTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function dispatchWebPush(
  endpoint: string,
  payload: { title: string; body: string; day?: number; url?: string; tag?: string }
): Promise<boolean> {
  const sub = pushSubscriptions.get(endpoint);
  if (!sub) return false;
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return true;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      pushSubscriptions.delete(endpoint);
    }
    return false;
  }
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY не настроен на сервере. Укажите его в Settings > Secrets или используйте собственный ключ в настройках приложения.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getTransientStatus(err: unknown): number | null {
  const status = (err as { status?: number })?.status;
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
    return status;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
    return 503;
  }
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 429;
  }
  return null;
}

async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    systemInstruction: string;
    responseSchema: Record<string, unknown>;
  }
) {
  const runModel = (model: string) =>
    ai.models.generateContent({
      model,
      contents: params.contents as Parameters<typeof ai.models.generateContent>[0]['contents'],
      config: {
        ...(model === MODEL_NAME ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        systemInstruction: params.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: params.responseSchema,
      },
    });

  try {
    return await runModel(MODEL_NAME);
  } catch (firstErr) {
    const status = getTransientStatus(firstErr);
    if (!status) throw firstErr;

    if (status !== 429) {
      await new Promise((r) => setTimeout(r, 700 + Math.floor(Math.random() * 250)));
      try {
        return await runModel(MODEL_NAME);
      } catch (retryErr) {
        if (!getTransientStatus(retryErr)) throw retryErr;
      }
    }
  }

  try {
    return await runModel(FALLBACK_MODEL_NAME);
  } catch (fallbackErr) {
    const status = getTransientStatus(fallbackErr);
    if (!status) throw fallbackErr;

    await new Promise((r) => setTimeout(r, 1400 + Math.floor(Math.random() * 300)));
    return await runModel(FALLBACK_MODEL_NAME);
  }
}

function getErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED')) {
    return { status: 403, message: 'Ошибка авторизации Gemini API. Проверьте ключ в Secrets или в настройках.' };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || lower.includes('high demand') || lower.includes('overloaded')) {
    return {
      status: 503,
      message: 'Серверы Gemini сейчас временно перегружены (503). Мы попробовали резервную модель — повторите запрос через 10–15 секунд.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Достигнут лимит запросов к Gemini API (429). Подождите 30–60 секунд и повторите попытку.',
    };
  }
  return { status: 500, message: raw || 'Внутренняя ошибка генерации контента.' };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, model: MODEL_NAME, pushReady: true });
  });

  app.get('/api/push/vapid-public-key', (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body?.subscription as PushSubscription | undefined;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'Некорректная Push-подписка.' });
    }
    pushSubscriptions.set(sub.endpoint, sub);
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (endpoint) {
      pushSubscriptions.delete(endpoint);
      const timer = scheduledPushTimers.get(endpoint);
      if (timer) {
        clearTimeout(timer);
        scheduledPushTimers.delete(endpoint);
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/push/schedule', (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    const unlockAtMs = Number(req.body?.unlockAtMs);
    const day = Number(req.body?.day);
    const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 140) : 'Daily AI Mastery';
    const body =
      typeof req.body?.body === 'string'
        ? req.body.body.slice(0, 240)
        : 'Подошло время следующего урока!';

    if (!endpoint || !pushSubscriptions.has(endpoint) || !Number.isFinite(unlockAtMs)) {
      return res.status(400).json({ error: 'Подписка не найдена или некорректное время.' });
    }

    const existingTimer = scheduledPushTimers.get(endpoint);
    if (existingTimer) {
      clearTimeout(existingTimer);
      scheduledPushTimers.delete(endpoint);
    }

    const delayMs = Math.max(0, Math.min(unlockAtMs - Date.now(), 7 * 24 * 60 * 60 * 1000));
    const timer = setTimeout(() => {
      scheduledPushTimers.delete(endpoint);
      void dispatchWebPush(endpoint, {
        title,
        body,
        day: Number.isInteger(day) ? day : undefined,
        url: '/',
        tag: `daily-ai-mastery-unlock-day-${day}`,
      });
    }, delayMs);

    scheduledPushTimers.set(endpoint, timer);
    res.json({ ok: true, scheduledInMs: delayMs });
  });

  app.post('/api/push/test', async (req, res) => {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
    if (!endpoint || !pushSubscriptions.has(endpoint)) {
      return res.status(404).json({ error: 'Активная Push-подписка не найдена.' });
    }
    const ok = await dispatchWebPush(endpoint, {
      title: 'Daily AI Mastery — Push активен',
      body: 'Мы напомним, когда откроется ваш следующий урок.',
      url: '/',
      tag: 'daily-ai-mastery-test',
    });
    if (!ok) {
      return res.status(502).json({ error: 'Не удалось доставить тестовый Push.' });
    }
    res.json({ ok: true });
  });

  app.post('/api/lessons/generate', async (req, res) => {
    try {
      const day = Number(req.body?.day);
      const previousTopics = Array.isArray(req.body?.previousTopics)
        ? req.body.previousTopics.filter((t: unknown): t is string => typeof t === 'string').slice(-8)
        : [];

      if (!Number.isInteger(day) || day < 6 || day > 365) {
        return res.status(400).json({ error: 'Некорректный номер дня для генерации урока.' });
      }

      const ai = getAiClient();
      const prompt = `Ты — ведущий архитектор ИИ-систем и преподаватель курса «Daily AI Mastery».
Сгенерируй структурированный технический микро-урок на русском языке для Дня ${day}.
Предыдущие изученные темы: ${previousTopics.length > 0 ? previousTopics.join(' | ') : 'Сети, Прокси/VPN, Безопасность API, MCP-серверы, ИИ-агенты'}.

Выбери следующую логичную продвинутую тему (например: RAG и гибридный поиск, Eval-тестирование LLM, Multi-Agent оркестрация, Guardrails и PII-редакция, Edge-деплой, MCP Auth и Sandboxing, Кэширование промптов и оптимизация токенов, Observability/OpenTelemetry для агентов). Не повторяй предыдущие темы.
Стиль: практичный, плотный, без воды, 3–4 абзаца + короткий рабочий пример кода + 1 проверочный вопрос по материалу этого урока с 4 вариантами ответа.`;

      const response = await generateContentWithFallback(ai, {
        contents: prompt,
        systemInstruction:
          'Отвечай строго валидным JSON на русском языке согласно схеме. correct_answer должен в точности совпадать с одним из элементов options.',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING, description: 'Заголовок урока (до 120 символов)' },
            category: { type: Type.STRING, description: 'Короткая категория, 1-2 слова' },
            readMinutes: { type: Type.INTEGER, description: 'Время чтения от 4 до 7 минут' },
            content: { type: Type.STRING, description: 'Основной текст урока с абзацами через двойной перенос строки' },
            code_example: { type: Type.STRING, description: 'Практический фрагмент кода TypeScript или YAML/JSON' },
            code_language: { type: Type.STRING, description: 'Язык кода, например typescript' },
            question: { type: Type.STRING, description: 'Контрольный вопрос для закрепления темы на следующий день' },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Ровно 4 варианта ответа',
            },
            correct_answer: { type: Type.STRING, description: 'Точная строка правильного варианта из options' },
            explanation: { type: Type.STRING, description: 'Краткое объяснение правильного ответа' },
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
        },
      });

      res.json({ raw: response.text ?? '{}' });
    } catch (err) {
      const { status, message } = getErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/lessons/deep-dive', async (req, res) => {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim().slice(0, 240) : '';
      const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 4000) : '';
      if (!topic) {
        return res.status(400).json({ error: 'Тема урока обязательна для Deep Dive.' });
      }

      const ai = getAiClient();
      const prompt = `Пользователь изучает урок «${topic}».
Краткое содержание урока:
${content}

Сформируй углублённый технический разбор (Deep Dive) уровня Senior AI Engineer на русском языке:
1) overview: архитектурные нюансы, подводные камни продакшена, поток данных и edge cases (2-3 содержательных абзаца).
2) code: конкретный production-ready пример кода или архитектурной конфигурации.
3) language: язык кода (например typescript).
4) tips: массив из 3-4 конкретных инженерных чек-поинтов для продакшена.`;

      const response = await generateContentWithFallback(ai, {
        contents: prompt,
        systemInstruction: 'Отвечай строго валидным JSON согласно responseSchema.',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING },
            code: { type: Type.STRING },
            language: { type: Type.STRING },
            tips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['overview', 'code', 'language', 'tips'],
        },
      });

      res.json({ raw: response.text ?? '{}' });
    } catch (err) {
      const { status, message } = getErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/lessons/weekly-quiz', async (req, res) => {
    try {
      const day = Number(req.body?.day);
      const coveredLessons = Array.isArray(req.body?.coveredLessons)
        ? req.body.coveredLessons.slice(0, 6)
        : [];

      if (!Number.isInteger(day) || day < 7 || day % 7 !== 0) {
        return res.status(400).json({ error: 'Еженедельный срез доступен на каждый 7-й день.' });
      }

      const ai = getAiClient();
      const summary = coveredLessons
        .map((l: { day?: number; topic?: string }) => `День ${l.day}: ${l.topic}`)
        .join('\n');

      const prompt = `Сформируй итоговый еженедельный срез знаний (День ${day}) из 6 практических вопросов по темам прошедших 6 дней:
${summary}

Каждый вопрос должен проверять глубокое понимание практики (прокси, безопасность, MCP, агенты, сети и т.д.), иметь ровно 4 варианта ответа, где correct_answer точно совпадает с одним из вариантов, и короткое пояснение.`;

      const response = await generateContentWithFallback(ai, {
        contents: prompt,
        systemInstruction: 'Отвечай строго валидным JSON на русском языке согласно схеме.',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.INTEGER },
                  topic: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correct_answer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['day', 'topic', 'question', 'options', 'correct_answer', 'explanation'],
              },
            },
          },
          required: ['title', 'questions'],
        },
      });

      res.json({ raw: response.text ?? '{}' });
    } catch (err) {
      const { status, message } = getErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/assistant/chat', async (req, res) => {
    try {
      const message =
        typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1500) : '';
      const systemPrompt =
        typeof req.body?.systemPrompt === 'string'
          ? req.body.systemPrompt.trim().slice(0, 3000)
          : 'Ты — персональный ИИ-наставник курса Daily AI Mastery. Отвечай на русском языке строго валидным JSON.';
      const history: Array<{ role: string; text: string }> = Array.isArray(req.body?.history)
        ? (req.body.history as unknown[])
            .filter(
              (m): m is { role: string; text: string } =>
                typeof m === 'object' &&
                m !== null &&
                typeof (m as { role?: unknown }).role === 'string' &&
                typeof (m as { text?: unknown }).text === 'string'
            )
            .slice(-6)
        : [];

      if (!message) {
        return res.status(400).json({ error: 'Введите вопрос или выберите подсказку.' });
      }

      const ai = getAiClient();
      const contents = [
        ...history.map((h) => ({
          role: h.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: h.text.slice(0, 1200) }],
        })),
        { role: 'user', parts: [{ text: message }] },
      ];

      const response = await generateContentWithFallback(ai, {
        contents,
        systemInstruction: systemPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: {
              type: Type.STRING,
              description: 'Понятный структурированный ответ на русском языке (2-3 абзаца)',
            },
            keyTakeaways: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-3 ключевых вывода или шага практики',
            },
            codeSnippet: {
              type: Type.STRING,
              description: 'Короткий практический фрагмент кода или конфига (если уместно, иначе пустая строка)',
            },
            codeLanguage: {
              type: Type.STRING,
              description: 'Язык кода, например typescript, bash, json',
            },
            nextDepthSuggestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-3 коротких вопроса-продолжения для следующего уровня углубления',
            },
          },
          required: ['answer', 'keyTakeaways', 'nextDepthSuggestions'],
        },
      });

      res.json({ raw: response.text ?? '{}' });
    } catch (err) {
      const { status, message } = getErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    // Serve a zero-WebSocket Vite client shim because HMR is disabled;
    // prevents proxied HTTPS environments from attempting wss://:24678.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (!queryToInject) return url;
  return url.includes('?') ? url + '&' + queryToInject : url + '?' + queryToInject;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('sw.js') ||
            filePath.endsWith('index.html') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Daily AI Mastery server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
