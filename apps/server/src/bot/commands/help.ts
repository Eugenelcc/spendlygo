import type { AppContext } from '../../context.js';
import { openAppKeyboard } from '../keyboards.js';
import type { BotContext } from '../middleware.js';

function receiptsSection(ocrEnabled: boolean): string {
  if (ocrEnabled) {
    return [
      '*Receipts* — send a photo',
      '',
      "Captioned with the amount (`12.50 lunch`), same as typing it — or with no caption at all and I'll try to read the total off the receipt myself. Always double-check the guess.",
    ].join('\n');
  }
  return [
    '*Receipts* — send a photo captioned with the amount',
    '',
    '`12.50 lunch` as the caption, same grammar as typing it.',
  ].join('\n');
}

const HELP_HEAD = `*Logging money*

Type the amount first, then what it was for:

\`12.50 lunch\`
\`8.20 grab\`
\`+3000 salary\`

*Optional extras* — any order, all optional

\`#category\` — file it yourself: \`12.50 lunch #food\`
\`@date\` — \`@today\`, \`@yesterday\`, \`@12/03\`
\`+\` — this is money coming in, not going out
\`k\` — thousands, so \`2.5k rent\` is 2,500

If you leave the category out, I'll guess it from what you wrote.
Every entry gets an *Undo* button for five minutes.`;

const HELP_TAIL = `*Digests* — a daily check-in at your chosen hour, plus a Sunday wrap-up and
an end-of-month summary. Turn them on or off in Settings.

*Recurring* — things that happen on their own

\`/recurring add 1500 rent monthly\`
\`/recurring add 15 netflix monthly #bills\`

*Sharing a budget* — with a partner, full transparency both ways

\`/household invite\` gives you a code; they send \`/join CODE\`. Either of you
can then change the budget, and you'll both see everything either of you logs.
Joining never drops you from your other spaces — \`/switch\` moves between all
of them, personal budget included.

*Savings goals* — tracked separately, never touching your monthly budget

\`/goals add 3000 vacation by 2026-12-31\`
\`/goals put 50 vacation\` — tag money toward it

*Recap* — a shareable wrap-up of your month or year

\`/recap\` for this month, \`/recap year\` for the whole year.

*Export* — your data, as a CSV file

\`/export\` for everything, \`/export 2026\` or \`/export 2026-08\` for a range.

*Commands*
/today — what's safe to spend today
/budget — show or set your monthly budget
/recurring — list or add recurring transactions
/household — share a budget with a partner
/switch — move between your spaces
/goals — savings goals and progress
/recap — your month or year at a glance
/export — download your data as CSV
/recent — your last 10 entries
/undo — undo the last entry
/app — open the app
/help — this message`;

export async function handleHelp(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const help = [
    HELP_HEAD,
    receiptsSection(ctx.config.ocrSpaceApiKey !== undefined),
    HELP_TAIL,
  ].join('\n\n');

  await botCtx.reply(help, {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });
}
