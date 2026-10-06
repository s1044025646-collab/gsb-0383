import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AddressInfo } from "node:net";
import { JosephusStore } from "./store.js";
import {
  assertEveryLabelOnce,
  computeJosephus,
  JosephusResult,
  verifyCandidate
} from "./engine.js";

type JsonValue = Record<string, unknown> | unknown[];

function readJson(request: IncomingMessage): Promise<JsonValue> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        rejectPromise(Object.assign(new Error("请求体过大"), { code: "PAYLOAD_TOO_LARGE" }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(body) as JsonValue);
      } catch {
        rejectPromise(Object.assign(new Error("请求体不是合法 JSON"), { code: "INVALID_JSON" }));
      }
    });
    request.on("error", rejectPromise);
  });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function positiveInteger(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw Object.assign(new Error(`查询参数必须是 1 到 ${max} 的整数`), {
      code: "INVALID_QUERY"
    });
  }
  return parsed;
}

function compareByStart(base: JosephusResult, compareStart: number) {
  const compared = computeJosephus({ n: base.n, k: base.k, start: compareStart });
  const baseToCompare = new Map<number, number>();
  const compareToBase = new Map<number, number>();
  const delta = compareStart - base.start;
  const rotate = (label: number): number => ((label - 1 + delta + base.n) % base.n) + 1;

  for (let label = 1; label <= base.n; label += 1) {
    const mapped = rotate(label);
    baseToCompare.set(label, mapped);
    compareToBase.set(mapped, label);
  }

  return {
    baseStart: base.start,
    compareStart: compared.start,
    baseEliminationOrder: base.eliminationOrder,
    compareEliminationOrder: compared.eliminationOrder,
    baseSurvivor: base.survivor,
    compareSurvivor: compared.survivor,
    rotatedBaseEliminationOrder: base.eliminationOrder.map(rotate),
    rotationPreservesStepwiseLabels:
      JSON.stringify(compared.eliminationOrder) ===
      JSON.stringify(base.eliminationOrder.map(rotate)),
    labelMap: { baseToCompare: Object.fromEntries(baseToCompare), compareToBase: Object.fromEntries(compareToBase) }
  };
}

export function createApp(store: JosephusStore) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const method = request.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === "POST" && url.pathname === "/cases") {
        const body = (await readJson(request)) as Record<string, unknown>;
        const created = store.createCase({
          n: Number(body.n),
          k: String(body.k ?? ""),
          start: Number(body.start)
        });
        assertEveryLabelOnce(created);
        sendJson(response, 201, created);
        return;
      }

      if (method === "GET" && url.pathname === "/cases") {
        sendJson(response, 200, { cases: store.listCases() });
        return;
      }

      const caseId = pathParts[1];
      if (pathParts[0] === "cases" && caseId) {
        const current = store.getCase(caseId);
        if (!current) {
          sendJson(response, 404, { code: "NOT_FOUND", message: "算例不存在" });
          return;
        }

        if (method === "GET" && pathParts.length === 2) {
          sendJson(response, 200, current);
          return;
        }

        if (method === "GET" && pathParts[2] === "steps" && pathParts.length === 3) {
          const stepText = url.searchParams.get("r");
          if (stepText !== null) {
            const stepNumber = Number(stepText);
            if (stepNumber === 0) {
              sendJson(response, 200, {
                boundary: "BEFORE_ELIMINATIONS",
                message: "r=0 表示尚未发生淘汰",
                step: null
              });
              return;
            }
            const step = store.getStep(caseId, Number(stepText));
            if (!step) {
              sendJson(response, 404, { code: "NOT_FOUND", message: "该淘汰步骤不存在" });
              return;
            }
            sendJson(response, 200, { step: 0, queried: step });
            return;
          }

          const limit = positiveInteger(url.searchParams.get("limit"), 100, current.n - 1 || 1);
          const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
          if (!Number.isInteger(offset) || offset > Math.max(0, current.n - 2)) {
            throw Object.assign(new Error("offset 超出步骤范围"), { code: "INVALID_QUERY" });
          }
          sendJson(response, 200, store.getSteps(caseId, { limit, offset }));
          return;
        }

        if (method === "GET" && pathParts[2] === "positions" && pathParts.length === 3) {
          const label = Number(url.searchParams.get("label"));
          const through = Number(url.searchParams.get("through") ?? current.n - 1);
          sendJson(response, 200, store.getPositionStatus(caseId, label, through));
          return;
        }

        if (method === "GET" && pathParts[2] === "export" && pathParts.length === 3) {
          sendJson(response, 200, {
            format: "josephus-case-v1",
            exportedAt: new Date().toISOString(),
            case: current
          });
          return;
        }

        if (method === "POST" && pathParts[2] === "verify" && pathParts.length === 3) {
          const body = (await readJson(request)) as Record<string, unknown>;
          sendJson(response, 200, verifyCandidate(current, body.candidate));
          return;
        }

        if (method === "POST" && pathParts[2] === "compare-start" && pathParts.length === 3) {
          const body = (await readJson(request)) as Record<string, unknown>;
          const compareStart = Number(body.start);
          sendJson(response, 200, compareByStart(current, compareStart));
          return;
        }
      }

      sendJson(response, 404, { code: "NOT_FOUND", message: "接口不存在" });
    } catch (error) {
      const code = (error as { code?: string }).code ?? "INTERNAL_ERROR";
      const status =
        code === "NOT_FOUND"
          ? 404
          : code === "PAYLOAD_TOO_LARGE"
            ? 413
            : code === "INTERNAL_ERROR"
              ? 500
              : 400;
      sendJson(response, status, {
        code,
        message: error instanceof Error ? error.message : "未知错误"
      });
    }
  });
}

async function listenOnFreePort(preferredPort?: number): Promise<number> {
  const port = preferredPort ?? Number(process.env.PORT ?? 0);
  return new Promise((resolvePort, rejectPort) => {
    const trial = createServer();
    trial.once("error", rejectPort);
    trial.listen(port, "127.0.0.1", () => {
      const address = trial.address() as AddressInfo;
      const selectedPort = address.port;
      trial.close(() => resolvePort(selectedPort));
    });
  });
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const databasePath = process.env.JOSEPHUS_DB
    ? resolve(process.cwd(), process.env.JOSEPHUS_DB)
    : resolve(here, "..", "data", "josephus.sqlite");
  const store = new JosephusStore(databasePath);
  const port = await listenOnFreePort();
  const app = createApp(store);

  app.listen(port, "127.0.0.1", () => {
    console.log(`约瑟夫环服务已启动: http://127.0.0.1:${port}`);
    console.log(`SQLite 数据库: ${databasePath}`);
  });

  const shutdown = () => {
    app.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
