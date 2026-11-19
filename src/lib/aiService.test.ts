import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_MODEL,
  GeminiHttpError,
  PRIMARY_MODEL,
  STATIC_HOSTING_API_ERROR,
  executeWithModelFallback,
  formatGeminiDirectError,
  parseJsonResponseText,
} from './aiService';

test('parseJsonResponseText detects Netlify SPA HTML fallback on /api/* and returns actionable message', () => {
  assert.throws(
    () =>
      parseJsonResponseText(
        '<!DOCTYPE html><html lang="ru"><head><title>Daily AI Mastery</title></head></html>',
        'text/html; charset=UTF-8',
        200,
        'backend',
        'Не удалось выполнить Deep Dive.'
      ),
    (err: unknown) =>
      err instanceof Error && err.message === STATIC_HOSTING_API_ERROR
  );
});

test('parseJsonResponseText parses valid backend JSON cleanly', () => {
  const result = parseJsonResponseText<{ raw?: string }>(
    '{"raw":"{\\"overview\\":\\"ok\\"}"}',
    'application/json',
    200,
    'backend',
    'Ошибка'
  );
  assert.equal(result.raw, '{"overview":"ok"}');
});

test('parseJsonResponseText detects HTML proxy error page on direct Gemini REST calls', () => {
  assert.throws(
    () =>
      parseJsonResponseText(
        '<html><body>502 Bad Gateway</body></html>',
        'text/html',
        502,
        'direct',
        'Ошибка'
      ),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('HTML-страницу вместо JSON') &&
      err.message.includes('502')
  );
});

test('parseJsonResponseText treats backend HTTP 404/405 without body as static hosting', () => {
  assert.throws(
    () =>
      parseJsonResponseText(
        '',
        null,
        404,
        'backend',
        'Не удалось выполнить Deep Dive'
      ),
    (err: unknown) =>
      err instanceof Error && err.message === STATIC_HOSTING_API_ERROR
  );
});

test('parseJsonResponseText handles non-JSON truncated payload without SyntaxError leak', () => {
  assert.throws(
    () =>
      parseJsonResponseText(
        'upstream timeout',
        'text/plain',
        504,
        'backend',
        'Не удалось выполнить Deep Dive'
      ),
    (err: unknown) =>
      err instanceof Error && err.message.includes('некорректный формат ответа')
  );
});

test('formatGeminiDirectError produces clear Russian message for 503 high demand JSON', () => {
  const body = JSON.stringify({
    error: {
      code: 503,
      message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary.',
      status: 'UNAVAILABLE',
    },
  });
  const msg = formatGeminiDirectError(503, body);
  assert.match(msg, /временно перегружены \(503\)/);
  assert.doesNotMatch(msg, /"error"/);
});

test('formatGeminiDirectError extracts retry-in seconds on 429 quota JSON', () => {
  const body = JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota. Please retry in 23.4s.',
      status: 'RESOURCE_EXHAUSTED',
    },
  });
  const msg = formatGeminiDirectError(429, body);
  assert.match(msg, /429/);
  assert.match(msg, /24 сек/);
  assert.doesNotMatch(msg, /"error"/);
});

test('formatGeminiDirectError distinguishes region block from invalid API key on 400/403', () => {
  const regionBody = JSON.stringify({
    error: { code: 400, message: 'User location is not supported for the API use.' },
  });
  assert.match(formatGeminiDirectError(400, regionBody), /Proxy URL/);
  assert.match(formatGeminiDirectError(403, regionBody), /Proxy URL/);

  const keyBody = JSON.stringify({
    error: { code: 403, message: 'API key not valid. Please pass a valid API key.' },
  });
  assert.match(formatGeminiDirectError(403, keyBody), /Неверный или отозванный Gemini API-ключ/);
});

test('executeWithModelFallback retries primary once on 503 then falls back to gemini-3.1-flash-lite', async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];

  const result = await executeWithModelFallback(
    async (model) => {
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        throw new GeminiHttpError(503, 'overloaded');
      }
      return 'ok-from-lite';
    },
    {
      baseDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );

  assert.equal(result, 'ok-from-lite');
  assert.deepEqual(calls, [PRIMARY_MODEL, PRIMARY_MODEL, FALLBACK_MODEL]);
  assert.equal(sleeps.length, 1);
});

test('executeWithModelFallback switches immediately to gemini-3.1-flash-lite on 429 without wasting a primary retry', async () => {
  const calls: string[] = [];
  const sleeps: number[] = [];

  const result = await executeWithModelFallback(
    async (model) => {
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        throw new GeminiHttpError(429, 'quota exceeded');
      }
      return 'ok-from-lite-quota';
    },
    {
      baseDelayMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );

  assert.equal(result, 'ok-from-lite-quota');
  assert.deepEqual(calls, [PRIMARY_MODEL, FALLBACK_MODEL]);
  assert.equal(sleeps.length, 0);
});

test('executeWithModelFallback fails fast on non-retryable 403 without fallback', async () => {
  const calls: string[] = [];

  await assert.rejects(
    () =>
      executeWithModelFallback(
        async (model) => {
          calls.push(model);
          throw new GeminiHttpError(403, 'invalid key');
        },
        {
          baseDelayMs: 10,
          sleep: async () => {},
        }
      ),
    (err: unknown) => err instanceof GeminiHttpError && err.status === 403
  );

  assert.deepEqual(calls, [PRIMARY_MODEL]);
});
