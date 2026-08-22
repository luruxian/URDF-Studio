import { getRuntimeLanguageTranslations } from '@/shared/i18n';

export function RobotsHandoffBlockedScreen() {
  const { t } = getRuntimeLanguageTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-6">
      <div
        role="alert"
        className="max-w-md rounded-2xl border border-border-black bg-panel-bg px-6 py-8 text-center shadow-lg"
      >
        <h1 className="text-lg font-semibold text-text-primary">{t.robotsHandoffBlockedTitle}</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          {t.robotsHandoffBlockedBody}
        </p>
      </div>
    </div>
  );
}
