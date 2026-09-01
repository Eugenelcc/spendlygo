/**
 * Receipt photo attachments (PRD F4).
 *
 * GUARDRAILS.md section 4: `tg_file_id` never reaches the client — every read
 * here is for the server's own use resolving a photo through
 * apps/server/src/api's `/photos/:id` proxy, never returned directly.
 *
 * Visibility mirrors `transactionsRepo`'s `scopedTo`: a space-mate can see a
 * shared transaction's photo, same as they can see the transaction itself —
 * the whole point of a shared budget being transparent rather than merely
 * combined (packages/db/src/repositories/transactions.ts).
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import { attachments, transactions, type Attachment } from '../schema.js';

export type OcrStatus = 'none' | 'pending' | 'done' | 'failed';

export interface CreateAttachmentInput {
  transactionId: string;
  userId: string;
  tgFileId: string;
  tgFileUniqueId: string;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  /** Defaults to 'none' — set once OCR has actually run (PRD F4.6). */
  ocrStatus?: OcrStatus;
  ocrPayload?: unknown;
}

export async function create(db: Database, input: CreateAttachmentInput): Promise<Attachment> {
  const rows = await db.insert(attachments).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('Insert returned no attachment');
  return row;
}

/**
 * A single attachment, only if it's on a transaction in `viewerHouseholdId` —
 * see the file header. Returns null for a stranger's photo just as readily
 * as for a missing id, so a proxy route can't distinguish "not found" from
 * "not yours" by response shape.
 */
export async function findViewable(
  db: Database,
  viewerHouseholdId: string,
  attachmentId: string,
): Promise<Attachment | null> {
  const rows = await db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(transactions, eq(attachments.transactionId, transactions.id))
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(transactions.householdId, viewerHouseholdId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);

  return rows[0]?.attachment ?? null;
}

/** Every visible attachment on one transaction, for the Mini App detail sheet. */
export async function listForTransaction(
  db: Database,
  viewerHouseholdId: string,
  transactionId: string,
): Promise<Attachment[]> {
  const rows = await db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(transactions, eq(attachments.transactionId, transactions.id))
    .where(
      and(
        eq(attachments.transactionId, transactionId),
        eq(transactions.householdId, viewerHouseholdId),
        isNull(transactions.deletedAt),
      ),
    );

  return rows.map((row) => row.attachment);
}
