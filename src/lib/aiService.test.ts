import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonResponseText,
  STATIC_HOSTING_API_ERROR,
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
