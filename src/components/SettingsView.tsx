import React, { useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  RotateCcw,
  Send,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { UserProgress, UserSettings } from '../types/curriculum';
import {
  formatReminderTime,
  type NotificationCapability,
  type ReminderSchedule,
} from '../lib/pushNotifications';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  user: User | null;
  authLoading: boolean;
  progress: UserProgress;
  settings: UserSettings;
  remindersEnabled: boolean;
  notificationCapability: NotificationCapability;
  reminderSchedule: ReminderSchedule | null;
  reminderStatusText: string | null;
  onToggleReminders: (enabled: boolean) => Promise<void>;
  onSendTestNotification: () => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSaveSettings: (next: UserSettings) => void;
  onToggleFastTrack: (enabled: boolean) => void;
  onResetProgress: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  authLoading,
  progress,
  settings,
  remindersEnabled,
  notificationCapability,
  reminderSchedule,
  reminderStatusText,
  onToggleReminders,
  onSendTestNotification,
  onGoogleSignIn,
  onSignOut,
  onSaveSettings,
  onToggleFastTrack,
  onResetProgress,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(settings.customApiKey);
  const [baseUrlInput, setBaseUrlInput] = useState(settings.customBaseUrl);
  const [showKey, setShowKey] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings({
      customApiKey: apiKeyInput.trim(),
      customBaseUrl: baseUrlInput.trim(),
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleClearApi = () => {
    setApiKeyInput('');
    setBaseUrlInput('');
    onSaveSettings({ customApiKey: '', customBaseUrl: '' });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await onGoogleSignIn();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Не удалось выполнить вход через Google.'
      );
    }
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Profile & Firebase Sync */}
      <section className="glass-surface rounded-3xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-100">Профиль и синхронизация</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {user
                ? 'Прогресс синхронизируется с облаком Firestore между вашими устройствами.'
                : 'Сейчас прогресс сохраняется локально в браузере. Войдите через Google для облачной синхронизации.'}
            </p>
          </div>
        </div>

        {user ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold text-slate-100 truncate">
                {user.displayName || 'Пользователь'}
              </p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Выйти</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              disabled={authLoading}
              onClick={handleSignIn}
              className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Войти через Google (Firebase)</span>
            </button>
            {authError && (
              <p className="text-xs text-rose-300 leading-relaxed">{authError}</p>
            )}
          </div>
        )}
      </section>

      {/* PWA Push Notifications & Mobile Install */}
      <section className="glass-surface rounded-3xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              {remindersEnabled ? (
                <BellRing className="w-5 h-5 text-sky-400 shrink-0" />
              ) : (
                <Bell className="w-5 h-5 text-slate-400 shrink-0" />
              )}
              <span>Push-уведомления о новых уроках</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Напоминает через Service Worker, когда истекает 24-часовой таймер и открывается новый урок или еженедельный срез.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            disabled={pushBusy || notificationCapability === 'unsupported'}
            aria-checked={remindersEnabled}
            aria-label="Включить Push-уведомления о разблокировке уроков"
            onClick={async () => {
              setPushBusy(true);
              try {
                await onToggleReminders(!remindersEnabled);
              } finally {
                setPushBusy(false);
              }
            }}
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
              remindersEnabled
                ? 'bg-sky-500 border-sky-400'
                : 'bg-slate-800 border-slate-700'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                remindersEnabled ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="rounded-2xl bg-slate-900/70 border border-white/5 p-4 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Статус уведомлений</span>
            <span
              className={`font-semibold flex items-center gap-1.5 ${
                remindersEnabled
                  ? 'text-emerald-300'
                  : notificationCapability === 'denied'
                    ? 'text-rose-300'
                    : 'text-slate-300'
              }`}
            >
              {remindersEnabled ? (
                <>
                  <BellRing className="w-3.5 h-3.5" />
                  <span>Активно</span>
                </>
              ) : notificationCapability === 'denied' ? (
                <>
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Заблокировано в браузере</span>
                </>
              ) : notificationCapability === 'ios-needs-install' ? (
                <span>Установите на экран «Домой» (iOS)</span>
              ) : notificationCapability === 'unsupported' ? (
                <span>Не поддерживается браузером</span>
              ) : (
                <span>Отключено</span>
              )}
            </span>
          </div>

          {remindersEnabled && reminderSchedule?.shouldScheduleFuture && (
            <p className="text-sky-300">
              Запланировано: День {reminderSchedule.targetDay} · откроется в{' '}
              <strong className="font-mono tabular-nums">
                {formatReminderTime(reminderSchedule.unlockAtMs)}
              </strong>
            </p>
          )}

          {reminderStatusText && (
            <p className="text-slate-300 leading-relaxed">{reminderStatusText}</p>
          )}
        </div>

        {remindersEnabled && (
          <button
            type="button"
            disabled={pushBusy}
            onClick={async () => {
              setPushBusy(true);
              try {
                await onSendTestNotification();
              } finally {
                setPushBusy(false);
              }
            }}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-sky-400" />
            <span>Отправить тестовое уведомление</span>
          </button>
        )}

        <div className="pt-4 border-t border-white/10 space-y-2.5">
          <h3 className="text-sm font-semibold text-slate-200">
            Установка на телефон (PWA)
          </h3>
          <PWAInstallButton variant="card" />
        </div>
      </section>

      {/* Custom API Key & Proxy Bypass (TZ 3.4 & 5) */}
      <section className="glass-surface rounded-3xl p-6 space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Обход блокировок и BYOK</span>
          </div>
          <h2 className="text-lg font-bold text-slate-100">
            Пользовательский ключ и Proxy URL
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            По умолчанию запросы идут через встроенный защищённый серверный прокси. При необходимости вы можете указать собственный ключ Gemini и адрес Cloudflare Worker: ключ хранится исключительно локально в localStorage и не отправляется на сервер разработчика.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="custom-gemini-key"
              className="block text-xs font-semibold text-slate-300"
            >
              Личный Gemini API-ключ (опционально)
            </label>
            <div className="relative flex items-center">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                id="custom-gemini-key"
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                className="w-full min-h-[46px] pl-10 pr-12 rounded-xl bg-slate-950/80 border border-slate-700/70 focus:border-sky-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                className="min-h-[44px] min-w-[44px] absolute right-0.5 flex items-center justify-center text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="custom-proxy-url"
              className="block text-xs font-semibold text-slate-300"
            >
              Кастомный Proxy / Base URL (например, Cloudflare Workers)
            </label>
            <div className="relative flex items-center">
              <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
              <input
                id="custom-proxy-url"
                type="url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder="https://my-gemini-proxy.workers.dev"
                className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-slate-950/80 border border-slate-700/70 focus:border-sky-400 focus:outline-none text-sm text-slate-100 placeholder:text-slate-600 font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm flex items-center gap-2 transition-colors"
            >
              {savedNotice ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Сохранено в localStorage</span>
                </>
              ) : (
                <span>Сохранить настройки</span>
              )}
            </button>
            {(apiKeyInput || baseUrlInput) && (
              <button
                type="button"
                onClick={handleClearApi}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
              >
                Вернуть встроенный сервер
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Fast-Track Training Mode & PWA Install */}
      <section className="glass-surface rounded-3xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-4 h-4 text-violet-400" />
              <span>Режим тренажёра (без 24ч ожидания)</span>
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              По умолчанию уроки открываются строго раз в 24 часа. Включите этот режим, чтобы сразу открывать следующие дни, тестировать генерацию Дня 6+ и срез Дня 7.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={progress.fastTrackMode}
            aria-label="Переключить режим тренажёра без 24ч ожидания"
            onClick={() => onToggleFastTrack(!progress.fastTrackMode)}
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors ${
              progress.fastTrackMode
                ? 'bg-sky-500 border-sky-400'
                : 'bg-slate-800 border-slate-700'
            }`}
          >
            <span
              className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                progress.fastTrackMode ? 'translate-x-7' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="pt-4 border-t border-white/10">
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Сбросить прогресс обучения</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-rose-200">Сбросить все дни и статистику?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmReset(false);
                  onResetProgress();
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold transition-colors"
              >
                Подтвердить сброс
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
