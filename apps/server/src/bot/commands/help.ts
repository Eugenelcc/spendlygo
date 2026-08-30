import type { AppContext } from '../../context.js';
import { openAppKeyboard } from '../keyboards.js';
import type { BotContext } from '../middleware.js';

const HELP = `*Logging money*

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
Every entry gets an *Undo* button for five minutes.

*Recurring* — things that happen on their own

\`/recurring add 1500 rent monthly\`
\`/recurring add 15 netflix monthly #bills\`

*Commands*
/today — what's safe to spend today
/budget — show or set your monthly budget
/recurring — list or add recurring transactions
/recent — your last 10 entries
/undo — undo the last entry
/app — open the app
/help — this message`;

export async function handleHelp(ctx: AppContext, botCtx: BotContext): Promise<void> {
  await botCtx.reply(HELP, {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });
}
