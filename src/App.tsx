import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Bot,
  CheckCircle2,
  Compass,
  Flame,
  Lock,
  Settings,
  Target,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { ONBOARDING_LESSONS } from './data/onboardingLessons';
import type {
  AssistantMessage,
  Lesson,
  UserProgress,
  UserSettings,
  WeeklyQuiz,
} from './types/curriculum';
import {
  applyDailyGateAnswer,
  calculateAccuracyPercent,
  completeLessonDay,
  completeWeeklyQuiz,
  createInitialProgress,
  getNextUnlockStatus,
  isWeeklyReviewDay,
  requiresDailyGateQuiz,
  resolveEffectiveProgress,
} from './lib/curriculumEngine';
import {
  askAdaptiveAssistant,
  generateDeepDive,
  generateDynamicLesson,
  generateWeeklyQuiz,
} from './lib/aiService';
import { computeMasteryProfile } from './lib/assistantEngine';
import {
  computeReminderSchedule,
  detectBrowserCapability,
  disablePushNotifications,
  enablePushNotifications,
  loadReminderPreferences,
  saveReminderPreferences,
  sendTestPushNotification,
  showServiceWorkerNotification,
  syncServerPushSchedule,
  type NotificationCapability,
  type ReminderPreferences,
} from './lib/pushNotifications';
import {
  ensureUserProgressDocument,
  loadUserLessonsFromFirestore,
  logoutFirebase,
  saveLessonToFirestore,
  saveQuizResultToFirestore,
  saveUserProgressToFirestore,
  signInWithGoogle,
  subscribeAuth,
} from './lib/firebase';
import { AssistantView } from './components/AssistantView';
import { DailyGateQuiz } from './components/DailyGateQuiz';
import { LessonView } from './components/LessonView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { RoadmapView } from './components/RoadmapView';
import { SettingsView } from './components/SettingsView';
import { WeeklyQuizView } from './components/WeeklyQuizView';

type TabKey = 'lesson' | 'assistant' | 'roadmap' | 'settings';

const LS_PROGRESS_KEY = 'daily_ai_mastery_progress_v1';
const LS_LESSONS_KEY = 'daily_ai_mastery_lessons_v1';
const LS_SETTINGS_KEY = 'daily_ai_mastery_settings_v1';
const LS_ASSISTANT_KEY = 'daily_ai_mastery_assistant_v1';

function loadLocalProgress(): UserProgress {
  try {
    const raw = localStorage.getItem(LS_PROGRESS_KEY);
    if (!raw) return createInitialProgress();
    const parsed = JSON.parse(raw) as Partial<UserProgress>;
    return {
      ...createInitialProgress(),
      ...parsed,
      completedDays: Array.isArray(parsed.completedDays) ? parsed.completedDays : [],
    };
  } catch {
    return createInitialProgress();
  }
}

function loadLocalLessons(): Record<number, Lesson> {
  const base: Record<number, Lesson> = {};
  for (const lesson of ONBOARDING_LESSONS) {
    base[lesson.day] = lesson;
  }
  try {
    const raw = localStorage.getItem(LS_LESSONS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Record<string, Lesson>;
    for (const [k, v] of Object.entries(saved)) {
      const dayNum = Number(k);
      if (Number.isInteger(dayNum) && v && v.topic) {
        if (base[dayNum] && v.deepDive) {
          base[dayNum] = { ...base[dayNum], deepDive: v.deepDive };
        } else if (!base[dayNum]) {
          base[dayNum] = v;
        }
      }
    }
  } catch {
    // Ignore corrupted cache
  }
  return base;
}

function loadLocalSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return { customApiKey: '', customBaseUrl: '' };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      customApiKey: typeof parsed.customApiKey === 'string' ? parsed.customApiKey : '',
      customBaseUrl: typeof parsed.customBaseUrl === 'string' ? parsed.customBaseUrl : '',
    };
  } catch {
    return { customApiKey: '', customBaseUrl: '' };
  }
}

function loadLocalAssistantMessages(): AssistantMessage[] {
  try {
    const raw = localStorage.getItem(LS_ASSISTANT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is AssistantMessage =>
          typeof m === 'object' &&
          m !== null &&
          typeof (m as { id?: unknown }).id === 'string' &&
          typeof (m as { text?: unknown }).text === 'string' &&
          ((m as { role?: unknown }).role === 'user' ||
            (m as { role?: unknown }).role === 'assistant')
      )
      .slice(-20);
  } catch {
    return [];
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('lesson');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [progress, setProgress] = useState<UserProgress>(() =>
    resolveEffectiveProgress(loadLocalProgress(), Date.now())
  );
  const [activeDay, setActiveDay] = useState<number>(() =>
    resolveEffectiveProgress(loadLocalProgress(), Date.now()).unlockedDay
  );
  const [lessonsMap, setLessonsMap] = useState<Record<number, Lesson>>(() =>
    loadLocalLessons()
  );
  const [settings, setSettings] = useState<UserSettings>(() => loadLocalSettings());

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [isLoadingLesson, setIsLoadingLesson] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);

  const [isDeepDiveLoading, setIsDeepDiveLoading] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

  const [weeklyQuizzes, setWeeklyQuizzes] = useState<Record<number, WeeklyQuiz>>({});
  const [isLoadingWeekly, setIsLoadingWeekly] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);

  const [reminderPrefs, setReminderPrefs] = useState<ReminderPreferences>(() =>
    loadReminderPreferences()
  );
  const [notificationCapability, setNotificationCapability] =
    useState<NotificationCapability>(() => detectBrowserCapability());
  const [reminderStatusText, setReminderStatusText] = useState<string | null>(null);

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>(() =>
    loadLocalAssistantMessages()
  );
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  // Live 1-second timer for 24-hour unlock countdown
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      setProgress((prev) => resolveEffectiveProgress(prev, current));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Persist local progress & lessons cache
  useEffect(() => {
    try {
      localStorage.setItem(LS_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Ignore storage quota errors
    }
  }, [progress]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_LESSONS_KEY, JSON.stringify(lessonsMap));
    } catch {
      // Ignore storage quota errors
    }
  }, [lessonsMap]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ASSISTANT_KEY,
        JSON.stringify(assistantMessages.slice(-20))
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [assistantMessages]);

  useEffect(() => {
    saveReminderPreferences(reminderPrefs);
  }, [reminderPrefs]);

  const reminderSchedule = useMemo(
    () => computeReminderSchedule(progress, reminderPrefs.lastNotifiedDay, nowMs),
    [progress, reminderPrefs.lastNotifiedDay, nowMs]
  );

  // Sync server-side Push timer when a lesson is locked for 24h
  useEffect(() => {
    if (!reminderPrefs.enabled || !reminderSchedule) return;

    if (reminderSchedule.shouldScheduleFuture && reminderPrefs.subscriptionEndpoint) {
      void syncServerPushSchedule({
        endpoint: reminderPrefs.subscriptionEndpoint,
        unlockAtMs: reminderSchedule.unlockAtMs,
        day: reminderSchedule.targetDay,
        title: reminderSchedule.title,
        body: reminderSchedule.body,
      });
    } else if (reminderSchedule.shouldFireNow) {
      setReminderPrefs((prev) => ({
        ...prev,
        lastNotifiedDay: Math.max(prev.lastNotifiedDay, reminderSchedule.targetDay),
      }));
      void showServiceWorkerNotification({
        title: reminderSchedule.title,
        body: reminderSchedule.body,
        day: reminderSchedule.targetDay,
        tag: reminderSchedule.tag,
        url: '/',
      });
    }
  }, [
    reminderPrefs.enabled,
    reminderPrefs.subscriptionEndpoint,
    reminderSchedule?.shouldScheduleFuture,
    reminderSchedule?.shouldFireNow,
    reminderSchedule?.targetDay,
    reminderSchedule?.unlockAtMs,
    reminderSchedule?.title,
    reminderSchedule?.body,
    reminderSchedule?.tag,
  ]);

  // Firebase Auth & Firestore Hydration
  useEffect(() => {
    const unsub = subscribeAuth(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const remoteProgress = await ensureUserProgressDocument(firebaseUser, progress);
          const resolved = resolveEffectiveProgress(remoteProgress, Date.now());
          setProgress(resolved);
          setActiveDay(resolved.unlockedDay);

          const remoteLessons = await loadUserLessonsFromFirestore(firebaseUser.uid);
          if (Object.keys(remoteLessons).length > 0) {
            setLessonsMap((prev) => {
              const merged = { ...prev };
              for (const [dayKey, lesson] of Object.entries(remoteLessons)) {
                const d = Number(dayKey);
                merged[d] = merged[d]?.isPreinstalled
                  ? { ...merged[d], deepDive: lesson.deepDive ?? merged[d].deepDive }
                  : lesson;
              }
              return merged;
            });
          }
        } catch (err) {
          console.error('Failed to sync Firestore state:', err);
        }
      }
      setAuthLoading(false);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistProgress = useCallback(
    (next: UserProgress) => {
      setProgress(next);
      if (user) {
        void saveUserProgressToFirestore(next, user).catch((err) => {
          console.error('Progress sync error:', err);
        });
      }
    },
    [user]
  );

  // Dynamic lesson generator for Day 6+
  const loadDynamicLessonForDay = useCallback(
    async (day: number) => {
      if (day <= 5 || isWeeklyReviewDay(day)) return;
      setIsLoadingLesson(true);
      setLessonError(null);
      try {
        const prevTopics = Object.values(lessonsMap)
          .filter((l) => l.day < day)
          .sort((a, b) => a.day - b.day)
          .map((l) => `День ${l.day}: ${l.topic}`);

        const generated = await generateDynamicLesson(day, prevTopics, settings);
        setLessonsMap((prev) => ({ ...prev, [day]: generated }));
        if (user) {
          void saveLessonToFirestore(user.uid, generated).catch((err) => {
            console.error('Lesson save error:', err);
          });
        }
      } catch (err) {
        setLessonError(
          err instanceof Error ? err.message : 'Ошибка генерации урока через Gemini API.'
        );
      } finally {
        setIsLoadingLesson(false);
      }
    },
    [lessonsMap, settings, user]
  );

  // Dynamic weekly quiz generator for Day 7, 14, ...
  const loadWeeklyQuizForDay = useCallback(
    async (day: number) => {
      if (!isWeeklyReviewDay(day)) return;
      setIsLoadingWeekly(true);
      setWeeklyError(null);
      try {
        const covered = Array.from({ length: 6 }, (_, i) => day - 6 + i).map((d) => ({
          day: d,
          topic: lessonsMap[d]?.topic || `День ${d}: Архитектура ИИ-систем`,
        }));
        const quiz = await generateWeeklyQuiz(day, covered, settings);
        setWeeklyQuizzes((prev) => ({ ...prev, [day]: quiz }));
      } catch (err) {
        setWeeklyError(
          err instanceof Error
            ? err.message
            : 'Ошибка генерации еженедельного среза знаний.'
        );
      } finally {
        setIsLoadingWeekly(false);
      }
    },
    [lessonsMap, settings]
  );

  const needsGate = requiresDailyGateQuiz(progress, activeDay);
  const currentLesson = lessonsMap[activeDay] ?? null;
  const previousLesson = lessonsMap[activeDay - 1] ?? ONBOARDING_LESSONS[0];
  const isWeekly = isWeeklyReviewDay(activeDay);

  // Trigger AI generation automatically when landing on unlocked Day 6+ or Day 7
  useEffect(() => {
    if (activeTab !== 'lesson') return;
    if (isWeekly) {
      if (!weeklyQuizzes[activeDay] && !isLoadingWeekly && !weeklyError) {
        void loadWeeklyQuizForDay(activeDay);
      }
      return;
    }
    if (!needsGate && activeDay >= 6 && !lessonsMap[activeDay] && !isLoadingLesson && !lessonError) {
      void loadDynamicLessonForDay(activeDay);
    }
  }, [
    activeTab,
    activeDay,
    isWeekly,
    needsGate,
    lessonsMap,
    weeklyQuizzes,
    isLoadingLesson,
    lessonError,
    isLoadingWeekly,
    weeklyError,
    loadDynamicLessonForDay,
    loadWeeklyQuizForDay,
  ]);

  const handleDailyGateComplete = (isCorrect: boolean) => {
    const next = applyDailyGateAnswer(progress, activeDay, isCorrect);
    persistProgress(next);
    if (user) {
      void saveQuizResultToFirestore(user.uid, {
        id: `daily_${activeDay}_${Date.now()}`,
        day: activeDay,
        quizType: 'daily',
        score: isCorrect ? 1 : 0,
        total: 1,
        passed: isCorrect,
        completedAtMs: Date.now(),
      }).catch((err) => console.error('Quiz result save error:', err));
    }
  };

  const handleRequestDeepDive = async () => {
    if (!currentLesson || isDeepDiveLoading) return;
    setIsDeepDiveLoading(true);
    setDeepDiveError(null);
    try {
      const deepDive = await generateDeepDive(
        currentLesson.topic,
        currentLesson.content,
        settings
      );
      const updatedLesson: Lesson = { ...currentLesson, deepDive };
      setLessonsMap((prev) => ({ ...prev, [currentLesson.day]: updatedLesson }));
      if (user) {
        void saveLessonToFirestore(user.uid, updatedLesson).catch((err) => {
          console.error('Deep Dive save error:', err);
        });
      }
    } catch (err) {
      setDeepDiveError(
        err instanceof Error ? err.message : 'Не удалось загрузить углублённый разбор.'
      );
    } finally {
      setIsDeepDiveLoading(false);
    }
  };

  const handleCompleteLesson = () => {
    const next = completeLessonDay(progress, activeDay, Date.now());
    persistProgress(next);
  };

  const handleCompleteWeekly = (correctCount: number, totalCount: number) => {
    const next = completeWeeklyQuiz(
      progress,
      activeDay,
      correctCount,
      totalCount,
      Date.now()
    );
    persistProgress(next);
    if (user) {
      void saveQuizResultToFirestore(user.uid, {
        id: `weekly_${activeDay}_${Date.now()}`,
        day: activeDay,
        quizType: 'weekly',
        score: correctCount,
        total: totalCount,
        passed: correctCount >= Math.ceil(totalCount / 2),
        completedAtMs: Date.now(),
      }).catch((err) => console.error('Weekly result save error:', err));
    }
  };

  const handleSaveSettings = (next: UserSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  };

  const handleToggleFastTrack = (enabled: boolean) => {
    const updated = resolveEffectiveProgress(
      { ...progress, fastTrackMode: enabled },
      Date.now()
    );
    persistProgress(updated);
  };

  const handleToggleReminders = useCallback(
    async (enable: boolean) => {
      if (!enable) {
        await disablePushNotifications(reminderPrefs.subscriptionEndpoint);
        setReminderPrefs((prev) => ({
          ...prev,
          enabled: false,
          subscriptionEndpoint: undefined,
        }));
        setNotificationCapability(detectBrowserCapability());
        setReminderStatusText('Напоминания отключены.');
        return;
      }

      const result = await enablePushNotifications();
      setNotificationCapability(detectBrowserCapability());
      setReminderStatusText(result.message);

      if (result.granted) {
        setReminderPrefs((prev) => ({
          ...prev,
          enabled: true,
          subscriptionEndpoint: result.endpoint,
        }));
      } else {
        setReminderPrefs((prev) => ({ ...prev, enabled: false }));
      }
    },
    [reminderPrefs.subscriptionEndpoint]
  );

  const handleSendTestNotification = useCallback(async () => {
    const res = await sendTestPushNotification(reminderPrefs.subscriptionEndpoint);
    if (res.ok) {
      setReminderStatusText(
        res.via === 'web-push'
          ? 'Тестовый Push отправлен через сервер и Service Worker.'
          : 'Тестовое уведомление отправлено через Service Worker.'
      );
    } else {
      setReminderStatusText(
        'Не удалось показать уведомление. Проверьте разрешения браузера.'
      );
    }
  }, [reminderPrefs.subscriptionEndpoint]);

  const handleResetProgress = () => {
    const fresh = createInitialProgress(user?.uid || 'local-guest');
    persistProgress(fresh);
    setActiveDay(1);
    setWeeklyQuizzes({});
    setLessonError(null);
    setDeepDiveError(null);
    setWeeklyError(null);
    setAssistantMessages([]);
    setAssistantError(null);
    const resetLessons: Record<number, Lesson> = {};
    for (const l of ONBOARDING_LESSONS) resetLessons[l.day] = l;
    setLessonsMap(resetLessons);
    setActiveTab('lesson');
  };

  const masteryProfile = useMemo(
    () => computeMasteryProfile(progress, currentLesson, lessonsMap),
    [progress, currentLesson, lessonsMap]
  );

  const handleSendAssistantMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isAssistantLoading) return;

      const userMsg: AssistantMessage = {
        id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: trimmed,
        createdAtMs: Date.now(),
      };

      const priorHistory = assistantMessages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setAssistantMessages((prev) => [...prev.slice(-19), userMsg]);
      setIsAssistantLoading(true);
      setAssistantError(null);
      setLastFailedPrompt(null);

      try {
        const reply = await askAdaptiveAssistant({
          message: trimmed,
          history: priorHistory,
          profile: masteryProfile,
          settings,
        });

        const assistantMsg: AssistantMessage = {
          id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          text: reply.answer,
          keyTakeaways: reply.keyTakeaways,
          codeSnippet: reply.codeSnippet,
          codeLanguage: reply.codeLanguage,
          nextDepthSuggestions: reply.nextDepthSuggestions,
          depthLabel: masteryProfile.label,
          createdAtMs: Date.now(),
        };
        setAssistantMessages((prev) => [...prev.slice(-19), assistantMsg]);
      } catch (err) {
        setLastFailedPrompt(trimmed);
        setAssistantError(
          err instanceof Error
            ? err.message
            : 'Не удалось получить ответ от ИИ-ассистента.'
        );
      } finally {
        setIsAssistantLoading(false);
      }
    },
    [assistantMessages, isAssistantLoading, masteryProfile, settings]
  );

  const handleAskAssistantAboutLesson = useCallback(() => {
    const prompt = `Подбери самое важное и углубись в тему Дня ${masteryProfile.currentDay}: «${masteryProfile.currentTopic}»`;
    setActiveTab('assistant');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void handleSendAssistantMessage(prompt);
  }, [handleSendAssistantMessage, masteryProfile.currentDay, masteryProfile.currentTopic]);

  const unlockStatus = useMemo(
    () => getNextUnlockStatus(progress, nowMs),
    [progress, nowMs]
  );

  const isCurrentCompleted = progress.completedDays.includes(activeDay);
  const isNextDayUnlocked = progress.unlockedDay > activeDay;
  const accuracy = calculateAccuracyPercent(progress);

  return (
    <div className="min-h-screen bg-[#070B14] bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_55%)] text-slate-100 relative overflow-x-hidden">
      <OfflineIndicator />

      {/* Top Navigation Bar (Strict 3-zone on Desktop, Compact 52px on Mobile) */}
      <header className="sticky top-0 z-30 h-[52px] lg:h-16 bg-[#070B14]/85 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-6xl mx-auto h-full px-4 lg:px-6 flex items-center justify-between gap-8">
          <a
            href="#lesson"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('lesson');
            }}
            className="text-base lg:text-lg font-extrabold tracking-tight text-slate-50 whitespace-nowrap shrink-0 flex items-center gap-2.5"
          >
            <img
              src="/icon.svg"
              alt=""
              className="w-6 h-6 rounded-md shrink-0"
            />
            <span>Daily AI Mastery</span>
          </a>

          <nav
            aria-label="Основная навигация"
            className="hidden lg:flex items-center gap-8 text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('lesson')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === 'lesson'
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              Урок дня
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('assistant')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === 'assistant'
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              ИИ-ассистент
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roadmap')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === 'roadmap'
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              Программа
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeTab === 'settings'
                  ? 'border-sky-400 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              Настройки
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton variant="compact" />
            <span className="lg:hidden text-xs font-semibold text-sky-300 tabular-nums whitespace-nowrap">
              День {activeDay}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Shell */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 lg:px-6 pt-5 pb-24 lg:py-8 lg:grid lg:grid-cols-[290px_1fr] lg:gap-8 items-start">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block sticky top-24 space-y-5">
          <div className="glass-surface rounded-3xl p-5 space-y-5">
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Текущий прогресс</p>
              <p className="text-2xl font-extrabold text-slate-50 tabular-nums">
                День {progress.unlockedDay}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-2xl bg-slate-900/70 border border-white/5 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Flame className="w-3.5 h-3.5 text-sky-400" />
                  <span>Серия</span>
                </div>
                <p className="text-lg font-bold text-slate-100 tabular-nums">
                  {progress.streakDays} дн.
                </p>
              </div>
              <div className="rounded-2xl bg-slate-900/70 border border-white/5 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Target className="w-3.5 h-3.5 text-violet-400" />
                  <span>Точность</span>
                </div>
                <p className="text-lg font-bold text-slate-100 tabular-nums">
                  {accuracy}%
                </p>
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <p className="text-xs font-medium text-slate-400 pb-1">
                Быстрый переход
              </p>
              {Array.from(
                { length: Math.max(7, progress.unlockedDay) },
                (_, i) => i + 1
              ).map((day) => {
                const unlocked = day <= progress.unlockedDay;
                const done = progress.completedDays.includes(day);
                const weekly = isWeeklyReviewDay(day);
                const selected = day === activeDay && activeTab === 'lesson';

                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!unlocked}
                    onClick={() => {
                      setActiveDay(day);
                      setLessonError(null);
                      setDeepDiveError(null);
                      setWeeklyError(null);
                      setActiveTab('lesson');
                    }}
                    className={`w-full min-h-[40px] px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                      selected
                        ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40'
                        : unlocked
                          ? 'text-slate-300 hover:bg-slate-800/70'
                          : 'text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <span className="truncate">
                      {weekly ? `День ${day} · Срез` : `День ${day}`}
                    </span>
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : weekly && unlocked ? (
                      <Award className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    ) : !unlocked ? (
                      <Lock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Primary Stage */}
        <main className="min-w-0 max-w-2xl mx-auto w-full lg:max-w-none">
          {activeTab === 'lesson' && (
            <>
              {isWeekly ? (
                <WeeklyQuizView
                  day={activeDay}
                  quiz={weeklyQuizzes[activeDay] ?? null}
                  isLoading={isLoadingWeekly}
                  error={weeklyError}
                  isCompleted={isCurrentCompleted}
                  onRetryLoad={() => {
                    setWeeklyError(null);
                    void loadWeeklyQuizForDay(activeDay);
                  }}
                  onCompleteWeekly={handleCompleteWeekly}
                  onGoToRoadmap={() => setActiveTab('roadmap')}
                  onOpenSettings={() => {
                    setActiveTab('settings');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ) : needsGate ? (
                <DailyGateQuiz
                  targetDay={activeDay}
                  previousLesson={previousLesson}
                  onComplete={handleDailyGateComplete}
                />
              ) : (
                <LessonView
                  lesson={currentLesson}
                  isLoadingLesson={isLoadingLesson}
                  lessonError={lessonError}
                  isCompleted={isCurrentCompleted}
                  isNextDayUnlocked={isNextDayUnlocked}
                  msUntilNextUnlock={unlockStatus.msRemaining}
                  fastTrackMode={progress.fastTrackMode}
                  isDeepDiveLoading={isDeepDiveLoading}
                  deepDiveError={deepDiveError}
                  remindersEnabled={reminderPrefs.enabled}
                  unlockAtMs={reminderSchedule?.unlockAtMs}
                  onEnableReminders={() => handleToggleReminders(true)}
                  onRetryLesson={() => {
                    setLessonError(null);
                    void loadDynamicLessonForDay(activeDay);
                  }}
                  onRequestDeepDive={handleRequestDeepDive}
                  onCompleteLesson={handleCompleteLesson}
                  onOpenNextDay={() => {
                    const next = activeDay + 1;
                    if (next <= progress.unlockedDay) {
                      setActiveDay(next);
                      setLessonError(null);
                      setDeepDiveError(null);
                      setWeeklyError(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  onOpenRoadmap={() => setActiveTab('roadmap')}
                  onOpenSettings={() => {
                    setActiveTab('settings');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onAskAssistant={handleAskAssistantAboutLesson}
                />
              )}
            </>
          )}

          {activeTab === 'assistant' && (
            <AssistantView
              profile={masteryProfile}
              messages={assistantMessages}
              isLoading={isAssistantLoading}
              error={assistantError}
              lastFailedPrompt={lastFailedPrompt}
              onSendMessage={handleSendAssistantMessage}
              onClearHistory={() => {
                setAssistantMessages([]);
                setAssistantError(null);
                setLastFailedPrompt(null);
              }}
              onOpenSettings={() => {
                setActiveTab('settings');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}

          {activeTab === 'roadmap' && (
            <RoadmapView
              progress={progress}
              lessonsMap={lessonsMap}
              activeDay={activeDay}
              nowMs={nowMs}
              onSelectDay={(day) => {
                setActiveDay(day);
                setLessonError(null);
                setDeepDiveError(null);
                setWeeklyError(null);
                setActiveTab('lesson');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              user={user}
              authLoading={authLoading}
              progress={progress}
              settings={settings}
              remindersEnabled={reminderPrefs.enabled}
              notificationCapability={notificationCapability}
              reminderSchedule={reminderSchedule}
              reminderStatusText={reminderStatusText}
              onToggleReminders={handleToggleReminders}
              onSendTestNotification={handleSendTestNotification}
              onGoogleSignIn={async () => {
                await signInWithGoogle();
              }}
              onSignOut={logoutFirebase}
              onSaveSettings={handleSaveSettings}
              onToggleFastTrack={handleToggleFastTrack}
              onResetProgress={handleResetProgress}
            />
          )}
        </main>
      </div>

      {/* Fixed Mobile Bottom Navigation Bar (64px height, thumb-zone ergonomics) */}
      <nav
        aria-label="Мобильная навигация"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#090F1D]/90 backdrop-blur-xl border-t border-white/10 pb-safe"
      >
        <div className="grid grid-cols-4 h-16 max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => {
              setActiveTab('lesson');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'lesson' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Урок</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('assistant');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'assistant' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bot className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Ассистент</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('roadmap');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'roadmap' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Программа</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('settings');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === 'settings' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[11px] font-medium tracking-tight">Настройки</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
