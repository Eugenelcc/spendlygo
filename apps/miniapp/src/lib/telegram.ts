/**
 * Telegram Mini App launch parameters.
 *
 * The Telegram client appends its launch parameters to the page's URL
 * fragment. Reading them directly means we contact no third-party origin and
 * ship no remote script (GUARDRAILS.md section 6), at the cost of doing the
 * theme-variable plumbing ourselves — which DESIGN.md section 2 wants anyway.
 *
 * `initData` is passed to the server verbatim; it is meaningless until the
 * server verifies its HMAC signature (GUARDRAILS.md section 4). Nothing here
 * trusts it, and nothing here reads the user id out of it.
 */

export interface ThemeParams {
  [key: string]: string | undefined;
}

export interface LaunchParams {
  /** The raw, signed initData query string. Opaque to this client. */
  initData: string | null;
  themeParams: ThemeParams;
  colorScheme: 'light' | 'dark';
  platform: string | null;
}

function readFragmentParams(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(hash);
}

export function retrieveLaunchParams(): LaunchParams {
  const params = readFragmentParams();

  let themeParams: ThemeParams = {};
  const rawTheme = params.get('tgWebAppThemeParams');
  if (rawTheme) {
    try {
      themeParams = JSON.parse(rawTheme) as ThemeParams;
    } catch {
      themeParams = {};
    }
  }

  return {
    initData: params.get('tgWebAppData'),
    themeParams,
    colorScheme: params.get('tgWebAppColorScheme') === 'dark' ? 'dark' : 'light',
    platform: params.get('tgWebAppPlatform'),
  };
}

/**
 * Publish Telegram's theme as the `--tg-theme-*` custom properties that
 * DESIGN.md section 2.1 maps our tokens onto. Outside Telegram nothing is set,
 * and the fallbacks in the stylesheet take over.
 */
export function applyThemeParams(theme: ThemeParams, colorScheme: 'light' | 'dark'): void {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme)) {
    if (typeof value !== 'string') continue;
    // bg_color -> --tg-theme-bg-color
    root.style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
  }

  root.dataset.colorScheme = colorScheme;
  root.style.colorScheme = colorScheme;
}

/** True when the page was opened from inside a Telegram client. */
export function isInsideTelegram(params: LaunchParams): boolean {
  return params.initData !== null && params.initData !== '';
}

// --- the Telegram bridge ----------------------------------------------------
//
// Telegram clients expose a message channel rather than a JS API, and
// `telegram-web-app.js` is a thin wrapper over it. Talking to the channel
// directly keeps GUARDRAILS.md section 6 intact (no third-party script, no
// external origin) at the cost of about twenty lines.

interface TelegramWebviewProxy {
  postEvent?: (eventType: string, eventData: string) => void;
}

declare global {
  interface Window {
    TelegramWebviewProxy?: TelegramWebviewProxy;
  }
}

/**
 * Telegram's Windows client uses `window.external.notify`. The DOM lib already
 * types `external` as `External`, so it is narrowed at the call site rather
 * than redeclared globally.
 */
function windowsNotify(): ((payload: string) => void) | null {
  const external = window.external as unknown as { notify?: unknown } | undefined;
  return typeof external?.notify === 'function'
    ? (external.notify as (payload: string) => void)
    : null;
}

/** Every call is wrapped: an unsupported client must degrade, never throw. */
function postEvent(eventType: string, eventData: Record<string, unknown> = {}): void {
  try {
    if (window.TelegramWebviewProxy?.postEvent) {
      window.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
      return;
    }
    const notify = windowsNotify();
    if (notify) {
      notify(JSON.stringify({ eventType, eventData }));
      return;
    }
    if (window.parent !== window) {
      window.parent.postMessage(JSON.stringify({ eventType, eventData }), '*');
    }
  } catch {
    /* Not inside Telegram, or the client does not support this event. */
  }
}

/** Tell Telegram the app has painted, and ask for the full sheet height. */
export function signalReady(): void {
  postEvent('web_app_ready');
  postEvent('web_app_expand');
}

/** Paint Telegram's own chrome to match the app background. */
export function setHeaderColor(color: string): void {
  postEvent('web_app_set_header_color', { color });
  postEvent('web_app_set_background_color', { color });
}

export function closeApp(): void {
  postEvent('web_app_close');
}

/**
 * Haptics (DESIGN.md section 6).
 *
 * Only ever fired in response to something the user did — never on load,
 * scroll, or incoming data.
 */
export const haptics = {
  tap: () =>
    postEvent('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'light' }),
  press: () =>
    postEvent('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'medium' }),
  soft: () =>
    postEvent('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'soft' }),
  rigid: () =>
    postEvent('web_app_trigger_haptic_feedback', { type: 'impact', impact_style: 'rigid' }),
  select: () => postEvent('web_app_trigger_haptic_feedback', { type: 'selection_change' }),
  success: () =>
    postEvent('web_app_trigger_haptic_feedback', {
      type: 'notification',
      notification_type: 'success',
    }),
  warning: () =>
    postEvent('web_app_trigger_haptic_feedback', {
      type: 'notification',
      notification_type: 'warning',
    }),
  error: () =>
    postEvent('web_app_trigger_haptic_feedback', {
      type: 'notification',
      notification_type: 'error',
    }),
};
