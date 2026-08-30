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
