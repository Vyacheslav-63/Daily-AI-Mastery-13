import type { UserProgress } from '../types/curriculum';
import {
  DAY_UNLOCK_INTERVAL_MS,
  getNextUnlockStatus,
  isWeeklyReviewDay,
} from './curriculumEngine';

export interface ReminderPreferences {
  enabled: boolean;
  lastNotifiedDay: number;
  subscriptionEndpoint?: string;
}

export type NotificationCapability =
  | 'supported'
  | 'denied'
  | 'ios-needs-install'
  | 'unsupported';

export interface ReminderSchedule {
  targetDay: number;
  isWeeklyReview: boolean;
  unlockAtMs: number;
  delayMs: number;
  shouldScheduleFuture: boolean;
  shouldFireNow: boolean;
  title: string;
  body: string;
  tag: string;
}

const LS_REMINDER_KEY = 'daily_ai_mastery_reminders_v1';

export function createDefaultReminderPreferences(): ReminderPreferences {
  return {
    enabled: false,
    lastNotifiedDay: 1,
  };
}

export function loadReminderPreferences(): ReminderPreferences {
  try {
    const raw = localStorage.getItem(LS_REMINDER_KEY);
    if (!raw) return createDefaultReminderPreferences();
    const parsed = JSON.parse(raw) as Partial<ReminderPreferences>;
    return {
      enabled: Boolean(parsed.enabled),
      lastNotifiedDay:
        typeof parsed.lastNotifiedDay === 'number' && parsed.lastNotifiedDay >= 1
          ? parsed.lastNotifiedDay
          : 1,
      subscriptionEndpoint:
        typeof parsed.subscriptionEndpoint === 'string'
          ? parsed.subscriptionEndpoint
          : undefined,
    };
  } catch {
    return createDefaultReminderPreferences();
  }
}

export function saveReminderPreferences(prefs: ReminderPreferences): void {
  try {
    localStorage.setItem(LS_REMINDER_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Pure helper: converts a base64url-encoded VAPID public key into a Uint8Array
 * accepted by PushManager.subscribe({ applicationServerKey }).
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  let binary: string;
  if (typeof atob === 'function') {
    binary = atob(base64);
  } else {
    binary = Buffer.from(base64, 'base64').toString('binary');
  }

  const outputArray = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    outputArray[i] = binary.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Pure helper: classifies browser notification support, including the iOS Safari
 * requirement that web push only works once installed to the Home Screen.
 */
export function getNotificationCapability(env: {
  hasNotificationApi: boolean;
  hasServiceWorker: boolean;
  permission: NotificationPermission | 'unsupported';
  isIOS: boolean;
  isStandalone: boolean;
}): NotificationCapability {
  if (env.isIOS && !env.isStandalone) {
    return 'ios-needs-install';
  }
  if (!env.hasNotificationApi) {
    return 'unsupported';
  }
  if (env.permission === 'denied') {
    return 'denied';
  }
  return env.hasServiceWorker || env.hasNotificationApi ? 'supported' : 'unsupported';
}

export function detectBrowserCapability(): NotificationCapability {
  if (typeof window === 'undefined') return 'unsupported';
  const ua = window.navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const hasNotificationApi = 'Notification' in window;
  const hasServiceWorker = 'serviceWorker' in navigator;
  const permission: NotificationPermission | 'unsupported' = hasNotificationApi
    ? Notification.permission
    : 'unsupported';

  return getNotificationCapability({
    hasNotificationApi,
    hasServiceWorker,
    permission,
    isIOS,
    isStandalone,
  });
}

/**
 * Pure helper: computes whether an unlock reminder should be scheduled in the future
 * or dispatched right now, with deduplication by `lastNotifiedDay`.
 */
export function computeReminderSchedule(
  progress: UserProgress,
  lastNotifiedDay: number,
  nowMs: number = Date.now()
): ReminderSchedule | null {
  const maxCompleted =
    progress.completedDays.length > 0 ? Math.max(...progress.completedDays) : 0;

  // No lesson completed yet -> Day 1 is already open, no countdown reminder needed
  if (maxCompleted === 0) {
    return null;
  }

  const status = getNextUnlockStatus(progress, nowMs);
  const targetDay = status.nextDay;
  const isWeekly = isWeeklyReviewDay(targetDay);

  const title = isWeekly
    ? `День ${targetDay}: Еженедельный срез открыт`
    : `День ${targetDay}: Новый урок Daily AI Mastery`;

  const body = isWeekly
    ? 'Проверьте знания за неделю в коротком срезе из 6 вопросов.'
    : `Пройдите быстрый вопрос по Дню ${targetDay - 1} и откройте новый урок.`;

  const tag = `daily-ai-mastery-unlock-day-${targetDay}`;

  if (status.isTimeLocked && status.msRemaining > 0) {
    const unlockAtMs = progress.lastCompletedAt + DAY_UNLOCK_INTERVAL_MS;
    return {
      targetDay,
      isWeeklyReview: isWeekly,
      unlockAtMs,
      delayMs: status.msRemaining,
      shouldScheduleFuture: true,
      shouldFireNow: false,
      title,
      body,
      tag,
    };
  }

  // Unlock time has arrived (or fast-track unlocked it): fire once if not yet notified
  const isAlreadyCompleted = progress.completedDays.includes(targetDay);
  const shouldFireNow =
    !isAlreadyCompleted && targetDay > lastNotifiedDay && targetDay > 1;

  return {
    targetDay,
    isWeeklyReview: isWeekly,
    unlockAtMs: nowMs,
    delayMs: 0,
    shouldScheduleFuture: false,
    shouldFireNow,
    title,
    body,
    tag,
  };
}

export function formatReminderTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Displays a notification using the active Service Worker registration (required on Android PWA)
 * with graceful fallback to the standard Web Notification constructor.
 */
export async function showServiceWorkerNotification(payload: {
  title: string;
  body: string;
  day?: number;
  tag?: string;
  url?: string;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(payload.title, {
          body: payload.body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: payload.tag || `daily-ai-mastery-day-${payload.day ?? 'info'}`,
          data: { url: payload.url || '/', day: payload.day },
        } as NotificationOptions);
        return true;
      }
    }
    new Notification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      tag: payload.tag,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Requests browser Notification permission and registers a real Web Push subscription
 * against the server's VAPID public key when PushManager is available.
 */
export async function enablePushNotifications(): Promise<{
  granted: boolean;
  endpoint?: string;
  mode: 'web-push' | 'local-sw' | 'denied' | 'unsupported';
  message: string;
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      granted: false,
      mode: 'unsupported',
      message: 'Ваш браузер не поддерживает веб-уведомления.',
    };
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    return {
      granted: false,
      mode: 'denied',
      message: 'Доступ к уведомлениям запрещён в настройках браузера.',
    };
  }

  // Attempt full VAPID Web Push subscription via Service Worker
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await fetch('/api/push/vapid-public-key');
      const keyCt = keyRes.headers.get('content-type') || '';
      if (keyRes.ok && keyCt.includes('application/json')) {
        const { publicKey } = (await keyRes.json()) as { publicKey?: string };
        if (publicKey) {
          let sub = await reg.pushManager.getSubscription();
          if (!sub) {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
            });
          }

          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          });

          return {
            granted: true,
            endpoint: sub.endpoint,
            mode: 'web-push',
            message: 'Push-уведомления активированы через Service Worker.',
          };
        }
      }
    }
  } catch {
    // Fall back gracefully to local Service Worker notifications if push service is unreachable
  }

  return {
    granted: true,
    mode: 'local-sw',
    message: 'Уведомления браузера включены (локальный режим PWA).',
  };
}

export async function disablePushNotifications(endpoint?: string): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      const targetEndpoint = sub?.endpoint || endpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      if (targetEndpoint) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: targetEndpoint }),
        });
      }
    }
  } catch {
    // Ignore unsubscribe network errors
  }
}

export async function syncServerPushSchedule(params: {
  endpoint?: string;
  unlockAtMs: number;
  day: number;
  title: string;
  body: string;
}): Promise<void> {
  if (!params.endpoint) return;
  try {
    await fetch('/api/push/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Client-side SW fallback still handles open sessions
  }
}

export async function sendTestPushNotification(endpoint?: string): Promise<{
  ok: boolean;
  via: 'web-push' | 'local-sw' | 'failed';
}> {
  if (endpoint) {
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        return { ok: true, via: 'web-push' };
      }
    } catch {
      // Fallback to local SW notification below
    }
  }

  const shown = await showServiceWorkerNotification({
    title: 'Daily AI Mastery — Напоминания работают',
    body: 'Мы сообщим, как только откроется ваш следующий урок.',
    tag: 'daily-ai-mastery-test',
  });
  return { ok: shown, via: shown ? 'local-sw' : 'failed' };
}
