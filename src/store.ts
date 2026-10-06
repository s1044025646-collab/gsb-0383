import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  computeJosephus,
  JosephusInput,
  JosephusResult,
  JosephusStep,
  validateInput,
  validateLabel,
  validateThroughRange
} from "./engine.js";

export type CaseSummary = {
  id: string;
  n: number;
  k: string;
  start: number;
  engineVersion: string;
  survivor: number;
  createdAt: string;
};

export type StepPage = {
  total: number;
  limit: number;
  offset: number;
  steps: JosephusStep[];
};

export type PositionStatus = {
  label: number;
  through: number;
  eliminated: boolean;
  eliminationStep: number | null;
  survivor: boolean;
};

export class JosephusStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createCase(input: JosephusInput): JosephusResult & { id: string } {
    const valid = validateInput(input);
    const result = computeJosephus(valid);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const insertCase = this.db.prepare(`
      INSERT INTO cases (id, n, k, start, engine_version, elimination_order, survivor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStep = this.db.prepare(`
      INSERT INTO steps (case_id, step, start_label, alive_count, moves, eliminated, next_start_label, remaining)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      insertCase.run(
        id,
        result.n,
        result.k,
        result.start,
        result.engineVersion,
        JSON.stringify(result.eliminationOrder),
        result.survivor,
        createdAt
      );
      for (const step of result.steps) {
        insertStep.run(
          id,
          step.step,
          step.startLabel,
          step.aliveCount,
          step.moves,
          step.eliminated,
          step.nextStartLabel,
          step.remaining
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return { id, ...result };
  }

  listCases(): CaseSummary[] {
    return this.db
      .prepare(
        `SELECT id, n, k, start, engine_version AS engineVersion, survivor, created_at AS createdAt
         FROM cases ORDER BY created_at DESC, id DESC`
      )
      .all() as CaseSummary[];
  }

  getCase(id: string): (JosephusResult & { id: string; createdAt: string }) | null {
    const row = this.db
      .prepare(
        `SELECT id, n, k, start, engine_version AS engineVersion, elimination_order AS eliminationOrder,
                survivor, created_at AS createdAt
         FROM cases WHERE id = ?`
      )
      .get(id) as
      | (Omit<JosephusResult, "steps"> & { id: string; createdAt: string; eliminationOrder: string })
      | undefined;

    if (!row) return null;

    const steps = this.getSteps(id, { limit: row.n - 1, offset: 0 }).steps;
    return {
      ...row,
      eliminationOrder: JSON.parse(row.eliminationOrder) as number[],
      steps
    };
  }

  getStep(id: string, step: number): JosephusStep | null {
    const summary = this.getSummaryOrThrow(id);
    if (!Number.isInteger(step) || step < 1 || step > summary.n - 1) {
      throw Object.assign(new Error(`step 必须是 1 到 ${summary.n - 1} 的整数`), {
        code: "INVALID_STEP"
      });
    }

    return (
      (this.db
        .prepare(
          `SELECT step, start_label AS startLabel, alive_count AS aliveCount, moves,
                  eliminated, next_start_label AS nextStartLabel, remaining
           FROM steps WHERE case_id = ? AND step = ?`
        )
        .get(id, step) as JosephusStep | undefined) ?? null
    );
  }

  getSteps(id: string, page: { limit: number; offset: number }): StepPage {
    const summary = this.getSummaryOrThrow(id);
    const total = summary.n - 1;
    const steps = this.db
      .prepare(
        `SELECT step, start_label AS startLabel, alive_count AS aliveCount, moves,
                eliminated, next_start_label AS nextStartLabel, remaining
         FROM steps WHERE case_id = ? ORDER BY step LIMIT ? OFFSET ?`
      )
      .all(id, page.limit, page.offset) as JosephusStep[];
    return { total, limit: page.limit, offset: page.offset, steps };
  }

  getPositionStatus(id: string, labelInput: unknown, throughInput: unknown): PositionStatus {
    const summary = this.getSummaryOrThrow(id);
    const label = validateLabel(summary.n, Number(labelInput));
    const through = validateThroughRange(summary.n, Number(throughInput));
    const order = this.getEliminationOrder(id);
    const eliminationIndex = order.indexOf(label);
    const eliminationStep = eliminationIndex === -1 ? null : eliminationIndex + 1;
    return {
      label,
      through,
      eliminated: eliminationStep !== null && eliminationStep <= through,
      eliminationStep,
      survivor: label === summary.survivor
    };
  }

  getEliminationOrder(id: string): number[] {
    const row = this.db.prepare("SELECT elimination_order AS json FROM cases WHERE id = ?").get(id) as
      | { json: string }
      | undefined;
    if (!row) {
      throw Object.assign(new Error("算例不存在"), { code: "NOT_FOUND" });
    }
    return JSON.parse(row.json) as number[];
  }

  getSummaryOrThrow(id: string): CaseSummary {
    const summary = this.db
      .prepare(
        `SELECT id, n, k, start, engine_version AS engineVersion, survivor, created_at AS createdAt
         FROM cases WHERE id = ?`
      )
      .get(id) as CaseSummary | undefined;
    if (!summary) {
      throw Object.assign(new Error("算例不存在"), { code: "NOT_FOUND" });
    }
    return summary;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        n INTEGER NOT NULL,
        k TEXT NOT NULL,
        start INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        elimination_order TEXT NOT NULL,
        survivor INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS steps (
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        step INTEGER NOT NULL,
        start_label INTEGER NOT NULL,
        alive_count INTEGER NOT NULL,
        moves INTEGER NOT NULL,
        eliminated INTEGER NOT NULL,
        next_start_label INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        PRIMARY KEY (case_id, step)
      );
    `);
  }
}
