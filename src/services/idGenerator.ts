import { pool } from '../db/pool';

const BLOCK_SIZE = 100_000;

/**
 * Distributed ID generation via block (range) allocation.
 *
 * Each process claims a block of IDs from Postgres in ONE query, then serves
 * IDs from memory. Tradeoffs (know these for interviews):
 *  - No per-request DB hit → fast create path.
 *  - Blocks are per-process → safe under Node cluster / multiple instances.
 *  - Unused IDs are discarded on restart → gaps. Acceptable: IDs are opaque,
 *    uniqueness matters, not density.
 */
class IdGenerator {
  private current = 0n;
  private blockEnd = 0n;
  private allocating: Promise<void> | null = null;

  async nextId(): Promise<bigint> {
    if (this.current >= this.blockEnd) {
      await this.allocate();
    }
    return this.current++; // returns current, then increments — works with BigInt
  }

  private async allocate(): Promise<void> {
    // Collapse concurrent refill attempts into one allocation...
    if (this.allocating) {
      await this.allocating;
      // ...then re-check: the other request's block may already be consumed
      // (possible with 100K+ truly concurrent requests). If so, get our own.
      if (this.current < this.blockEnd) return;
    }
    this.allocating = this.doAllocate();
    try {
      await this.allocating;
    } finally {
      this.allocating = null;
    }
  }

  private async doAllocate(): Promise<void> {
    // Atomic in Postgres: row lock on UPDATE guarantees two processes
    // can never receive overlapping ranges.
    const { rows } = await pool.query<{ start: string }>(
      `UPDATE counter
          SET value = value + $1
        WHERE id = 1
    RETURNING value - $1 AS start`,
      [BLOCK_SIZE],
    );
    this.current = BigInt(rows[0].start);
    this.blockEnd = this.current + BigInt(BLOCK_SIZE);
  }
}

export const idGenerator = new IdGenerator();