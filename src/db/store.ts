import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  ENGINE_VERSION,
  JosephusParams,
  JosephusResult,
  StepRecord,
  ValidationError,
} from "../core/josephus";

export interface CaseRow {
  id: number;
  n: number;
  k: string;
  start: number;
  engine_version: string;
  status: string;
  survivor: number | null;
  created_at: string;
}

export class CaseStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        n INTEGER NOT NULL,
        k TEXT NOT NULL,
        start INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        survivor INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS steps (
        case_id INTEGER NOT NULL,
        step INTEGER NOT NULL,
        count_from INTEGER NOT NULL,
        alive_count INTEGER NOT NULL,
        effective_move INTEGER NOT NULL,
        eliminated INTEGER NOT NULL,
        next_start INTEGER,
        remaining INTEGER NOT NULL,
        PRIMARY KEY (case_id, step),
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * 保存完整计算结果。整个写入在单个事务中完成：
   * 计算失败或写入中途失败时不会留下可见的不完整报告。
   */
  saveResult(params: JosephusParams, result: JosephusResult): number {
    const insertCase = this.db.prepare(
      `INSERT INTO cases (n, k, start, engine_version, status, survivor)
       VALUES (?, ?, ?, ?, 'done', ?)`,
    );
    const insertStep = this.db.prepare(
      `INSERT INTO steps
         (case_id, step, count_from, alive_count, effective_move, eliminated, next_start, remaining)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      const info = insertCase.run(
        params.n,
        params.k,
        params.start,
        ENGINE_VERSION,
        result.survivor,
      );
      const caseId = Number(info.lastInsertRowid);
      for (const s of result.steps) {
        insertStep.run(
          caseId,
          s.step,
          s.countFrom,
          s.aliveCount,
          s.effectiveMove,
          s.eliminated,
          s.nextStart,
          s.remaining,
        );
      }
      return caseId;
    });
    return tx();
  }

  getCase(id: number): CaseRow | null {
    const row = this.db
      .prepare(`SELECT * FROM cases WHERE id = ? AND status = 'done'`)
      .get(id) as CaseRow | undefined;
    return row ?? null;
  }

  requireCase(id: number): CaseRow {
    const row = this.getCase(id);
    if (!row) {
      throw new ValidationError("CASE_NOT_FOUND", `算例 ${id} 不存在或未完成`);
    }
    return row;
  }

  listCases(limit: number, offset: number): CaseRow[] {
    return this.db
      .prepare(
        `SELECT * FROM cases WHERE status = 'done'
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as CaseRow[];
  }

  getStep(caseId: number, step: number): StepRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM steps WHERE case_id = ? AND step = ?`)
      .get(caseId, step) as
      | {
          step: number;
          count_from: number;
          alive_count: number;
          effective_move: number;
          eliminated: number;
          next_start: number | null;
          remaining: number;
        }
      | undefined;
    if (!row) return null;
    return {
      step: row.step,
      countFrom: row.count_from,
      aliveCount: row.alive_count,
      effectiveMove: row.effective_move,
      eliminated: row.eliminated,
      nextStart: row.next_start,
      remaining: row.remaining,
    };
  }

  getSteps(caseId: number, limit: number, offset: number): StepRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM steps WHERE case_id = ?
         ORDER BY step LIMIT ? OFFSET ?`,
      )
      .all(caseId, limit, offset) as Array<{
      step: number;
      count_from: number;
      alive_count: number;
      effective_move: number;
      eliminated: number;
      next_start: number | null;
      remaining: number;
    }>;
    return rows.map((row) => ({
      step: row.step,
      countFrom: row.count_from,
      aliveCount: row.alive_count,
      effectiveMove: row.effective_move,
      eliminated: row.eliminated,
      nextStart: row.next_start,
      remaining: row.remaining,
    }));
  }

  totalSteps(caseId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM steps WHERE case_id = ?`)
      .get(caseId) as { c: number };
    return row.c;
  }

  eliminationOrder(caseId: number): number[] {
    const rows = this.db
      .prepare(`SELECT eliminated FROM steps WHERE case_id = ? ORDER BY step`)
      .all(caseId) as Array<{ eliminated: number }>;
    return rows.map((r) => r.eliminated);
  }

  /**
   * 查询原编号 label 在前 r 步内是否已被淘汰。
   * r = 0 表示尚未发生任何淘汰；r >= n-1 时除幸存者外全部已淘汰。
   */
  labelStatus(
    caseRow: CaseRow,
    label: number,
    r: number,
  ): { label: number; eliminated: boolean; eliminatedAt: number | null; r: number } {
    if (!Number.isInteger(label) || label < 1 || label > caseRow.n) {
      throw new ValidationError(
        "INVALID_LABEL",
        `label 必须是 1..${caseRow.n} 之间的整数`,
      );
    }
    if (!Number.isInteger(r) || r < 0) {
      throw new ValidationError("INVALID_R", "r 必须是 >= 0 的整数");
    }
    const row = this.db
      .prepare(`SELECT step FROM steps WHERE case_id = ? AND eliminated = ?`)
      .get(caseRow.id, label) as { step: number } | undefined;
    const eliminatedAt = row ? row.step : null;
    const eliminated = eliminatedAt !== null && eliminatedAt <= r;
    return { label, eliminated, eliminatedAt, r };
  }
}

export function defaultDbPath(): string {
  return process.env.JOSEPHUS_DB
    ? path.resolve(process.env.JOSEPHUS_DB)
    : path.join(process.cwd(), "data", "josephus.db");
}
