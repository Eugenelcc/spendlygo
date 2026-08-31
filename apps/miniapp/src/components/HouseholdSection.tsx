import { useState, type JSX } from 'react';
import type { Household } from '@spendlygo/shared';
import { haptics } from '../lib/telegram';

export interface HouseholdSectionProps {
  household: Household | null;
  loading: boolean;
  inviteCode: string | null;
  inviteBusy: boolean;
  leaveBusy: boolean;
  onCreateInvite: () => void;
  onLeave: () => void;
}

/**
 * Shared budgets (PRD-adjacent feature).
 *
 * Joining is deliberately chat-only — `/join CODE` — because it needs the
 * partner to already be talking to the bot. This section covers everything
 * else: seeing who you share with, generating a code for them, and leaving.
 */
export function HouseholdSection({
  household,
  loading,
  inviteCode,
  inviteBusy,
  leaveBusy,
  onCreateInvite,
  onLeave,
}: HouseholdSectionProps): JSX.Element {
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  if (loading) {
    return (
      <section className="card">
        <div className="card__label">Shared budget</div>
        <div className="skeleton" />
      </section>
    );
  }

  if (household === null) {
    return (
      <section className="card">
        <div className="card__label">Shared budget</div>
        <p className="card__prose">
          Share your budget with a partner — you'll both see everything either of you logs, and
          either of you can change it.
        </p>

        {inviteCode ? (
          <div className="invite">
            <span className="invite__label">Send them this in Telegram</span>
            <code className="invite__code">/join {inviteCode}</code>
            <span className="invite__hint">
              Valid for 24 hours. They need to message this bot first.
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="primary primary--inline"
            disabled={inviteBusy}
            onClick={() => {
              haptics.press();
              onCreateInvite();
            }}
          >
            {inviteBusy ? 'Generating…' : 'Get an invite code'}
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card__label">Shared budget</div>
      <div className="members">
        {household.members.map((member) => (
          <span className="members__chip" key={member.userId}>
            {member.isSelf ? 'You' : (member.firstName ?? 'Partner')}
          </span>
        ))}
      </div>
      <p className="card__prose">
        Everything either of you logs shows up for both of you, and either of you can change the
        budget.
      </p>

      {household.members.length < 2 &&
        (inviteCode ? (
          <div className="invite">
            <span className="invite__label">Send them this in Telegram</span>
            <code className="invite__code">/join {inviteCode}</code>
          </div>
        ) : (
          <button
            type="button"
            className="primary primary--inline"
            disabled={inviteBusy}
            onClick={() => {
              haptics.press();
              onCreateInvite();
            }}
          >
            {inviteBusy ? 'Generating…' : 'Invite someone else'}
          </button>
        ))}

      {confirmingLeave ? (
        <div className="leave-confirm">
          <p className="card__prose">
            Your own past entries stay with you. You'll stop seeing your partner's, and go back to
            your own budget.
          </p>
          <div className="leave-confirm__actions">
            <button type="button" className="link" onClick={() => setConfirmingLeave(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="danger danger--inline"
              disabled={leaveBusy}
              onClick={() => {
                haptics.rigid();
                onLeave();
              }}
            >
              {leaveBusy ? 'Leaving…' : 'Leave shared budget'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="link"
          onClick={() => {
            haptics.tap();
            setConfirmingLeave(true);
          }}
        >
          Leave shared budget
        </button>
      )}
    </section>
  );
}
