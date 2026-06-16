// The shared **outcome vocabulary** for write-intent cores. A write core returns
// an OUTCOME — settled, a small tally, or an abort flag — never a value (CQS at
// the type level; see ./README.md §"CQS at the type level"). Most plain writes
// return {@link Settled}; seeders / batch ops return {@link Tally}; abortable ops
// mix in {@link Aborted}. Rooms (`{room}`), `RestoreArchive` (`{…, reissued}`) and
// the read cores keep bespoke shapes. The already-shipped
// `ShareBuildingOutcome {recipientsShared}` predates this vocabulary and is left
// as-is (a per-recipient tally by another name).

/** A plain write succeeded; there is nothing further to report. */
export interface Settled {
  readonly ok: true;
}

/** A batch/seed write's progress: how many of how many items committed. */
export interface Tally {
  readonly done: number;
  readonly total: number;
}

/** An abortable write's cancellation flag — a user cancel is an outcome, not an error. */
export interface Aborted {
  readonly aborted: boolean;
}
