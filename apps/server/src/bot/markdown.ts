/**
 * Escaping for Telegram's legacy Markdown parse mode.
 *
 * Legacy Markdown treats only `_`, `*`, backtick and `[` as special. MarkdownV2
 * additionally reserves `.`, `-`, `(`, `)` and more — and escaping those here
 * would be worse than doing nothing, because a backslash before an ordinary
 * character is rendered literally. `S$12\.50` in a confirmation card is exactly
 * the kind of detail that makes software feel broken.
 */
const LEGACY_MARKDOWN_SPECIALS = /([_*`[])/g;

export function escapeMarkdown(value: string): string {
  return value.replace(LEGACY_MARKDOWN_SPECIALS, '\\$1');
}
