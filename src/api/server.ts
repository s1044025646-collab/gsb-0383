import express, { Express, NextFunction, Request, Response } from "express";
import net from "node:net";
import {
  computeJosephus,
  parseParams,
  validateCandidate,
  verifyOrder,
  ValidationError,
} from "./validate";
import { CaseStore } from "../db/store";

export function createApp(store: CaseStore): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const ok = (res: Response, data: unknown) => res.json({ ok: true, data });

  // 新建算例并完整计算
  app.post("/api/cases", (req, res) => {
    const params = parseParams(req.body ?? {});
    const result = computeJosephus(params);
    const id = store.saveResult(params, result);
    ok(res, {
      id,
      params,
      survivor: result.survivor,
      totalSteps: result.steps.length,
    });
  });

  // 算例列表（分页）
  app.get("/api/cases", (req, res) => {
    const limit = clampInt(req.query.limit, 1, 500, 50);
    const offset = clampInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    ok(res, store.listCases(limit, offset));
  });

  // 算例概要
  app.get("/api/cases/:id", (req, res) => {
    const row = store.requireCase(pathId(req));
    ok(res, {
      id: row.id,
      params: { n: row.n, k: row.k, start: row.start },
      engineVersion: row.engine_version,
      survivor: row.survivor,
      totalSteps: store.totalSteps(row.id),
      createdAt: row.created_at,
    });
  });

  // 完整淘汰顺序与幸存者
  app.get("/api/cases/:id/result", (req, res) => {
    const row = store.requireCase(pathId(req));
    ok(res, {
      id: row.id,
      eliminationOrder: store.eliminationOrder(row.id),
      survivor: row.survivor,
    });
  });

  // 逐步日志（分页）
  app.get("/api/cases/:id/steps", (req, res) => {
    const row = store.requireCase(pathId(req));
    const limit = clampInt(req.query.limit, 1, 1000, 100);
    const offset = clampInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    ok(res, {
      total: store.totalSteps(row.id),
      limit,
      offset,
      steps: store.getSteps(row.id, limit, offset),
    });
  });

  // 查询第 r 次淘汰
  app.get("/api/cases/:id/steps/:r", (req, res) => {
    const row = store.requireCase(pathId(req));
    const r = Number(req.params.r);
    if (!Number.isInteger(r) || r < 1) {
      throw new ValidationError("INVALID_R", "r 必须是 >= 1 的整数");
    }
    const step = store.getStep(row.id, r);
    if (!step) {
      throw new ValidationError(
        "STEP_OUT_OF_RANGE",
        `该算例共有 ${store.totalSteps(row.id)} 次淘汰，第 ${r} 步不存在`,
      );
    }
    ok(res, step);
  });

  // 查询某编号是否在前 r 步内被淘汰
  app.get("/api/cases/:id/labels/:label", (req, res) => {
    const row = store.requireCase(pathId(req));
    const label = Number(req.params.label);
    const r = clampInt(req.query.r, 0, Number.MAX_SAFE_INTEGER, row.n - 1);
    ok(res, store.labelStatus(row, label, r));
  });

  // 比较不同起点：对每个 start 计算幸存者与淘汰顺序摘要
  app.post("/api/compare", (req, res) => {
    const body = req.body ?? {};
    const starts: unknown[] = Array.isArray(body.starts) ? body.starts : [];
    if (starts.length < 1 || starts.length > 64) {
      throw new ValidationError(
        "INVALID_STARTS",
        "starts 必须是 1..64 个起点编号组成的数组",
      );
    }
    const results = starts.map((s) => {
      const params = parseParams({ n: body.n, k: body.k, start: s });
      const r = computeJosephus(params);
      return {
        start: params.start,
        survivor: r.survivor,
        eliminationOrder: r.eliminationOrder,
      };
    });
    ok(res, results);
  });

  // 规则核验：用户提供候选淘汰顺序
  app.post("/api/verify", (req, res) => {
    const body = req.body ?? {};
    const params = parseParams(body);
    const candidate = validateCandidate(body.candidate, params.n);
    const mismatch = verifyOrder(params, candidate);
    ok(res, {
      valid: mismatch === null,
      mismatch,
      message:
        mismatch === null
          ? "候选顺序完全符合规则"
          : `第 ${mismatch.step} 步不符：当时存活 ${mismatch.aliveCount} 人，` +
            `应淘汰 ${mismatch.expected}，候选给出 ${mismatch.actual ?? "（缺失）"}`,
    });
  });

  // 错误处理：统一错误码
  app.use(
    (err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, error: { code: err.code, message: err.message } });
        return;
      }
      res
        .status(500)
        .json({ ok: false, error: { code: "INTERNAL", message: err.message } });
    },
  );

  return app;
}

function pathId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError("INVALID_ID", "算例 id 必须是正整数");
  }
  return id;
}

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  dflt: number,
): number {
  if (raw === undefined) return dflt;
  const v = Number(raw);
  if (!Number.isInteger(v)) {
    throw new ValidationError("INVALID_PAGINATION", `分页参数必须是整数: ${raw}`);
  }
  if (v < min || v > max) {
    throw new ValidationError(
      "INVALID_PAGINATION",
      `分页参数 ${raw} 超出范围 [${min}, ${max}]`,
    );
  }
  return v;
}

/** 选择空闲端口：port 为 0 时由系统分配 */
export function pickPort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(preferred, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });
  });
}
