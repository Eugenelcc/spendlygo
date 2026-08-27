import type { AppContext } from '../../context.js';
import { openAppKeyboard } from '../keyboards.js';
import type { BotContext } from '../middleware.js';

const HELP = `*Logging money*

Type an amount and a note:
\`12.50 lunch\`  ·  \`8.20 grab #transport\`
\`+3000 salary\`  ·  \`45 dinner @yesterday\`

Modifiers (any order, all optional):
\`#category\` — set the category
\`@date\` — \`today\`, \`yesterday\`, or \`12/03\`
\`+\` — this is income, not a spend
\`k\` — thousands, so \`2.5k\` is 2,500

*Commands*
/app — open Spendlygo
/help — this message
/start — start over

_More commands arrive as features ship — see the roadmap in the repo._`;

export async function handleHelp(ctx: AppContext, botCtx: BotContext): Promise<void> {
  await botCtx.reply(HELP, {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });
}
