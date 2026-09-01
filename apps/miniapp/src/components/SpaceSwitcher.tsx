import { useState, type JSX } from 'react';
import type { Space } from '@spendlygo/shared';
import { haptics } from '../lib/telegram';
import { Sheet } from './Sheet';

export interface SpaceSwitcherProps {
  spaces: Space[];
  loading: boolean;
  switching: boolean;
  onSwitch: (householdId: string) => void;
}

/** "Personal", or the other members' first names — never "you", never empty. */
function labelFor(space: Space): string {
  if (space.isPersonal) return 'Personal';
  const others = space.members.filter((member) => !member.isSelf);
  return others.length > 0
    ? others.map((member) => member.firstName ?? 'Partner').join(' & ')
    : 'Shared (just you so far)';
}

/**
 * A profile-style switcher pill, visible on every screen — PRD F12.2. Moves
 * between spaces you already belong to; joining a new one is still chat-only
 * (`/join CODE`, same as HouseholdSection's invite flow needs a partner
 * already talking to the bot).
 */
export function SpaceSwitcher({
  spaces,
  loading,
  switching,
  onSwitch,
}: SpaceSwitcherProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const active = spaces.find((space) => space.isActive);

  if (loading || !active) {
    return <div className="space-switcher space-switcher--loading" aria-hidden="true" />;
  }

  return (
    <>
      <button
        type="button"
        className="space-switcher"
        onClick={() => {
          haptics.tap();
          setOpen(true);
        }}
      >
        <span className="space-switcher__avatar" aria-hidden="true">
          {active.isPersonal ? '🙂' : '👥'}
        </span>
        <span className="space-switcher__label">{labelFor(active)}</span>
        {spaces.length > 1 && (
          <span className="space-switcher__chevron" aria-hidden="true">
            ⌄
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your spaces">
        <div className="card__label">Your spaces</div>
        <div className="space-list">
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              className={`space-list__item ${space.isActive ? 'space-list__item--on' : ''}`}
              disabled={switching}
              onClick={() => {
                if (space.isActive) {
                  setOpen(false);
                  return;
                }
                haptics.select();
                onSwitch(space.id);
                setOpen(false);
              }}
            >
              <span className="space-list__avatar" aria-hidden="true">
                {space.isPersonal ? '🙂' : '👥'}
              </span>
              <span className="space-list__label">{labelFor(space)}</span>
              {space.isActive && (
                <span className="space-list__check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="card__prose">
          To join another space, send <code>/join CODE</code> to the bot in Telegram.
        </p>
      </Sheet>
    </>
  );
}
