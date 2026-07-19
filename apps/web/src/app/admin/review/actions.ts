'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@nidhi/db';
import { hasInternalAccess } from '@/lib/api';

/**
 * Approve or reject a pending signal.
 *
 * The gate is checked again here rather than trusted from the page. A server
 * action is a callable endpoint, so a page that refused to render is no defence
 * at all. This is still a shared secret and not an authentication system: the
 * reviewer is recorded as the holder of the token, which is the honest label
 * until a real provider sits in front of this queue.
 */

type Decision = 'approved' | 'rejected';

const REVIEWER = 'internal review token holder';

async function decide(flagId: number, decision: Decision, note: string): Promise<void> {
  if (!Number.isInteger(flagId) || flagId <= 0) return;
  if (!(await hasInternalAccess())) {
    console.warn('[admin] a review decision was refused because the token did not match');
    return;
  }

  try {
    await query(
      `UPDATE anomaly_flag
          SET status = $2,
              reviewed_by = $3,
              reviewed_at = now(),
              review_note = NULLIF($4, '')
        WHERE flag_id = $1
          AND status = 'pending'`,
      [flagId, decision, REVIEWER, note.slice(0, 2000)],
    );
  } catch (error) {
    console.error('[admin] could not record the review decision', error);
    return;
  }

  revalidatePath('/admin/review');
  revalidatePath('/flags');
}

function readForm(formData: FormData): { flagId: number; note: string } {
  const rawId = formData.get('flagId');
  const rawNote = formData.get('note');
  return {
    flagId: Number(typeof rawId === 'string' ? rawId : NaN),
    note: typeof rawNote === 'string' ? rawNote.trim() : '',
  };
}

export async function approveFlag(formData: FormData): Promise<void> {
  const { flagId, note } = readForm(formData);
  await decide(flagId, 'approved', note);
}

export async function rejectFlag(formData: FormData): Promise<void> {
  const { flagId, note } = readForm(formData);
  await decide(flagId, 'rejected', note);
}
