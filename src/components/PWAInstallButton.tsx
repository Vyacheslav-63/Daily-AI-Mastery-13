import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'card' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return variant === 'card' ? (
      <p className="text-sm text-emerald-400 font-medium">
        Приложение уже установлено на телефон (Standalone режим).
      </p>
    ) : null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={handleAction}
          aria-label="Установить приложение на телефон"
          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>На телефон</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleAction}
          className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Smartphone className="w-4 h-4" />
          <span>
            {isInstallable
              ? 'Скачать Daily AI Mastery на телефон'
              : 'Как установить на телефон (PWA)'}
          </span>
        </button>
      )}

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div className="glass-surface-elevated w-full max-w-sm rounded-3xl p-6 space-y-4 animate-fade-up">
            <div className="flex items-start justify-between gap-4">
              <h3 id="pwa-guide-title" className="text-lg font-bold text-slate-100">
                Установка на телефон
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Закрыть окно установки"
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-300 leading-relaxed list-decimal list-inside">
                <li>
                  Нажмите <strong className="text-slate-100">Поделиться</strong> в нижней панели Safari.
                </li>
                <li>
                  Выберите <strong className="text-slate-100">На экран «Домой»</strong>.
                </li>
                <li>
                  Нажмите <strong className="text-slate-100">Добавить</strong> — после этого заработают и Push-уведомления.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm text-slate-300 leading-relaxed list-decimal list-inside">
                <li>
                  Откройте меню браузера (три точки в углу экрана).
                </li>
                <li>
                  Нажмите <strong className="text-slate-100">Установить приложение</strong> или <strong className="text-slate-100">Добавить на главный экран</strong>.
                </li>
                <li>
                  Приложение займёт меньше 1 МБ и будет работать как нативное, включая офлайн-доступ и Push-напоминания.
                </li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-sm font-bold transition-colors"
            >
              Понятно
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-14 left-4 right-4 sm:left-auto sm:right-6 sm:w-auto z-40 rounded-xl bg-amber-500/95 text-slate-950 px-3.5 py-2 text-xs font-semibold flex items-center gap-2 shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Автономный режим — доступны сохранённые уроки</span>
    </div>
  );
};
