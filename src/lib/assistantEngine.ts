import type {
  AssistantDepthLevel,
  AssistantReply,
  Lesson,
  MasteryProfile,
  UserProgress,
} from '../types/curriculum';
import { calculateAccuracyPercent } from './curriculumEngine';

/**
 * Pure helper: computes the learner's current mastery level and adaptive prompts
 * from completed lessons, quiz accuracy, and the active day's topic.
 */
export function computeMasteryProfile(
  progress: UserProgress,
  activeLesson: Lesson | null,
  lessonsMap: Record<number, Lesson>
): MasteryProfile {
  const completedCount = progress.completedDays.length;
  const accuracyPercent = calculateAccuracyPercent(progress);

  let level: AssistantDepthLevel = 1;
  let label: MasteryProfile['label'] = 'Старт';
  let depthHint =
    'Объясняй ясно и наглядно, через практические аналогии, минимум лишнего жаргона, короткие рабочие примеры.';

  if (completedCount >= 6 || (completedCount >= 5 && accuracyPercent >= 85)) {
    level = 4;
    label = 'Архитектор';
    depthHint =
      'Давай уровень Senior/Architect: распределённая архитектура, режимы отказов, безопасность, evals, компромиссы по задержке и стоимости.';
  } else if (completedCount >= 4) {
    level = 3;
    label = 'Инженер';
    depthHint =
      'Давай инженерную глубину: паттерны оркестрации, рабочие фрагменты TypeScript/конфигов, оптимизация и защита продакшена.';
  } else if (completedCount >= 2) {
    level = 2;
    label = 'Практик';
    depthHint =
      'Фокус на практике: пошаговые настройки, частые ошибки новичков, реальные сценарии интеграции и отладки.';
  }

  const completedTopics = [...progress.completedDays]
    .sort((a, b) => a - b)
    .map((day) => lessonsMap[day]?.topic)
    .filter((topic): topic is string => Boolean(topic));

  const currentDay = activeLesson?.day ?? progress.unlockedDay;
  const currentTopic =
    activeLesson?.topic ?? 'Основы работы с ИИ-инфраструктурой и API';
  const currentCategory = activeLesson?.category ?? 'ИИ-инженерия';

  const suggestedPrompts = [
    `Подбери главное и углубись в тему Дня ${currentDay}: «${currentTopic}»`,
    level <= 2
      ? `Объясни на простом практическом примере из реального проекта`
      : `Разбери подводные камни в продакшене и покажи рабочий код`,
    completedCount > 0
      ? `Свяжи «${currentTopic}» с пройденными темами и подскажи следующий шаг`
      : `С чего начать практику сегодня за 10 минут?`,
  ];

  return {
    level,
    label,
    depthHint,
    currentDay,
    currentTopic,
    currentCategory,
    completedTopics,
    accuracyPercent,
    suggestedPrompts,
  };
}

/**
 * Pure helper: constructs the system instruction that steers Gemini to adapt
 * information selection and technical depth to the learner's real progress.
 */
export function buildAssistantSystemPrompt(profile: MasteryProfile): string {
  const completedList =
    profile.completedTopics.length > 0
      ? profile.completedTopics.join('; ')
      : 'пока нет (пользователь на первом уроке)';

  return `Ты — персональный ИИ-наставник приложения «Daily AI Mastery».
Твоя задача: автоматически подбирать самую полезную информацию и постепенно углублять тему по мере роста пользователя.

Профиль ученика:
- Уровень глубины: ${profile.level}/4 (${profile.label})
- Текущий день: День ${profile.currentDay} — «${profile.currentTopic}» (${profile.currentCategory})
- Уже пройденные темы: ${completedList}
- Точность в тестах: ${profile.accuracyPercent}%

Правила адаптации:
- ${profile.depthHint}
- Не повторяй базовые определения из уже пройденных тем, а опирайся на них и веди на шаг глубже.
- Пиши кратко, структурированно и понятно на русском языке (удобно читать с экрана телефона: 2–3 абзаца).
- Всегда предлагай 2–3 логичных следующих шага (nextDepthSuggestions), которые углубляют тему ещё на уровень выше.
- Отвечай строго валидным JSON согласно схеме.`;
}

/**
 * Pure helper: parses and sanitizes Gemini's structured assistant JSON reply.
 */
export function parseAssistantReply(rawText: string): AssistantReply {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Ассистент вернул пустой ответ.');
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const cleaned = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Graceful plain-text fallback if a custom proxy stripped JSON formatting
    return {
      answer: trimmed,
      keyTakeaways: [],
      nextDepthSuggestions: [
        'Покажи практический пример кода',
        'Какие частые ошибки встречаются на практике?',
      ],
    };
  }

  const answer =
    typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  if (!answer) {
    throw new Error('Ответ ассистента не содержит текста.');
  }

  const keyTakeaways = Array.isArray(parsed.keyTakeaways)
    ? parsed.keyTakeaways
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 4)
    : [];

  const codeSnippet =
    typeof parsed.codeSnippet === 'string' && parsed.codeSnippet.trim().length > 0
      ? parsed.codeSnippet.trim()
      : undefined;

  const codeLanguage =
    typeof parsed.codeLanguage === 'string' && parsed.codeLanguage.trim().length > 0
      ? parsed.codeLanguage.trim()
      : codeSnippet
        ? 'typescript'
        : undefined;

  const nextDepthSuggestions = Array.isArray(parsed.nextDepthSuggestions)
    ? parsed.nextDepthSuggestions
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 3)
    : [];

  return {
    answer,
    keyTakeaways,
    codeSnippet,
    codeLanguage,
    nextDepthSuggestions:
      nextDepthSuggestions.length > 0
        ? nextDepthSuggestions
        : ['Углубиться в архитектуру дальше', 'Разобрать практический пример'],
  };
}
