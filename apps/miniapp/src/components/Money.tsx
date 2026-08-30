import type { JSX } from 'react';
import { formatAmount, currencySymbol } from '../lib/format';

export interface HeroAmountProps {
  cents: number;
  currency: string;
  locale: string;
}

/**
 * The hero figure (DESIGN.md section 3).
 *
 * Cents render smaller and top-aligned, and the whole thing uses tabular
 * figures so the digits do not jitter while the value changes.
 */
export function HeroAmount({ cents, currency, locale }: HeroAmountProps): JSX.Element {
  const text = formatAmount(cents, locale);
  const [whole, fraction = '00'] = text.split('.');

  return (
    <div className="hero-amount" aria-label={`${currencySymbol(currency, locale)}${text}`}>
      <span className="hero-amount__symbol">{currencySymbol(currency, locale)}</span>
      <span className="hero-amount__whole">{whole}</span>
      <span className="hero-amount__fraction">{fraction}</span>
    </div>
  );
}
