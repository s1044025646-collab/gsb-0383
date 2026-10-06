#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  computeJosephus,
  parseParams,
  verifyOrder,
  ValidationError,
} from "../core/josephus";
import { validateCandidate } from "../api/validate";
import { CaseStore, defaultDbPath } from "../db/store";

const USAGE = `约瑟夫环报数淘汰 CLI（编号从 1 开始，起点本人算一）

用法: josephus <命令> [参数]

命令:
  new --n <n> --k <k> --start <s>   新建算例并完整计算，保存到数据库
  list [--limit N]                  列出已保存算例
  result --id <id>                  查看完整淘汰顺序与幸存者
  steps --id <id> [--offset O] [--limit L]   分页查看逐步解释
  step --id <id> --r <r>            查看第 r 次淘汰详情
  label --id <id> --label <x> [--r R]        查询编号 x 在前 R 步内是否已淘汰
  compare --n <n> --k <k> --starts a,b,c     比较不同起点的结果
  verify --n <n> --k <k> --start <s> --order 3,6,2,...   核验候选淘汰顺序
  export --id <id> [--format json|csv] [--out 文件]      导出淘汰序列
  demo                              运行 n=7,k=3,start=1 演示与超大 k 演示

环境变量:
  JOSEPHUS_DB   数据库文件路径（默认 ./data/josephus.db）
`;

interface Args {
  _: string[];
  [key: string]: string | string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = "true";
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function str(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" ? v : undefined;
}

function need(args: Args, key: string): string {
  const v = str(args, key);
  if (v === undefined) throw new ValidationError("MISSING_ARG", `缺少参数 --${key}`);
  return v;
}

function needId(args: Args): number {
  const id = Number(need(args, "id"));
  if (!Number.isInteger(id) || id < 1) {
    throw new ValidationError("INVALID_ID", "--id 必须是正整数");
  }
  return id;
}

function paramsFromArgs(args: Args) {
  return parseParams({
    n: need(args, "n"),
    k: need(args, "k"),
    start: need(args, "start"),
  });
}

interface StepLike {
  step: number;
  countFrom: number;
  aliveCount: number;
  effectiveMove: number;
  eliminated: number;
  nextStart: number | null;
  remaining: number;
}

function printStep(s: StepLike): void {
  const next = s.nextStart === null ? "无（已结束）" : String(s.nextStart);
  console.log(
    `第 ${s.step} 步: 从 ${s.countFrom} 开始报数, 当时 ${s.aliveCount} 人, ` +
      `有效移动 ${s.effectiveMove} 步, 淘汰 ${s.eliminated}, ` +
      `下一起点 ${next}, 剩余 ${s.remaining} 人`,
  );
}

function runDemo(store: CaseStore): void {
  console.log("== 演示 1: n=7, k=3, start=1 ==");
  const p1 = parseParams({ n: 7, k: "3", start: 1 });
  const r1 = computeJosephus(p1);
  for (const s of r1.steps) printStep(s);
  console.log(`淘汰顺序: ${r1.eliminationOrder.join(", ")}`);
  console.log(`幸存者: ${r1.survivor}`);
  const id1 = store.saveResult(p1, r1);
  console.log(`已保存为算例 id=${id1}`);

  console.log("");
  console.log("== 演示 2: n=7, k=10^30, start=1（取模跳步，非漫长循环） ==");
  const bigK = "1" + "0".repeat(30);
  const p2 = parseParams({ n: 7, k: bigK, start: 1 });
  const r2 = computeJosephus(p2);
  for (const s of r2.steps) printStep(s);
  console.log(`淘汰顺序: ${r2.eliminationOrder.join(", ")}`);
  console.log(`幸存者: ${r2.survivor}`);
  const id2 = store.saveResult(p2, r2);
  console.log(`已保存为算例 id=${id2}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const store = new CaseStore(defaultDbPath());
  try {
    switch (cmd) {
      case "new": {
        const params = paramsFromArgs(args);
        const result = computeJosephus(params);
        const id = store.saveResult(params, result);
        console.log(`算例 id=${id} 计算完成`);
        console.log(`淘汰顺序: ${result.eliminationOrder.join(", ")}`);
        console.log(`幸存者: ${result.survivor}`);
        break;
      }
      case "list": {
        const limit = Number(str(args, "limit") ?? "20");
        for (const row of store.listCases(limit, 0)) {
          console.log(
            `id=${row.id} n=${row.n} k=${row.k} start=${row.start} ` +
              `survivor=${row.survivor} engine=${row.engine_version} ${row.created_at}`,
          );
        }
        break;
      }
      case "result": {
        const row = store.requireCase(needId(args));
        console.log(`淘汰顺序: ${store.eliminationOrder(row.id).join(", ")}`);
        console.log(`幸存者: ${row.survivor}`);
        break;
      }
      case "steps": {
        const row = store.requireCase(needId(args));
        const limit = Number(str(args, "limit") ?? "100");
        const offset = Number(str(args, "offset") ?? "0");
        const total = store.totalSteps(row.id);
        console.log(`共 ${total} 步，显示第 ${offset + 1}..${Math.min(offset + limit, total)} 步`);
        for (const s of store.getSteps(row.id, limit, offset)) printStep(s);
        break;
      }
      case "step": {
        const row = store.requireCase(needId(args));
        const r = Number(need(args, "r"));
        const step = store.getStep(row.id, r);
        if (!step) {
          throw new ValidationError("STEP_OUT_OF_RANGE", `第 ${r} 步不存在`);
        }
        printStep(step);
        break;
      }
      case "label": {
        const row = store.requireCase(needId(args));
        const label = Number(need(args, "label"));
        const r = Number(str(args, "r") ?? String(row.n - 1));
        const st = store.labelStatus(row, label, r);
        console.log(
          st.eliminated
            ? `编号 ${st.label} 在前 ${st.r} 步内已被淘汰（第 ${st.eliminatedAt} 步出局）`
            : `编号 ${st.label} 在前 ${st.r} 步内未被淘汰` +
                (st.eliminatedAt !== null ? `（第 ${st.eliminatedAt} 步出局）` : "（幸存者）"),
        );
        break;
      }
      case "compare": {
        const starts = need(args, "starts")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const s of starts) {
          const params = parseParams({ n: need(args, "n"), k: need(args, "k"), start: s });
          const r = computeJosephus(params);
          console.log(
            `start=${params.start}: 幸存者 ${r.survivor}, 淘汰顺序 ${r.eliminationOrder.join(", ")}`,
          );
        }
        break;
      }
      case "verify": {
        const params = paramsFromArgs(args);
        const candidate = validateCandidate(
          need(args, "order").split(",").map((s) => Number(s.trim())),
          params.n,
        );
        const mismatch = verifyOrder(params, candidate);
        if (mismatch === null) {
          console.log("候选顺序完全符合规则");
        } else {
          console.log(
            `第 ${mismatch.step} 步不符: 当时存活 ${mismatch.aliveCount} 人, ` +
              `应淘汰 ${mismatch.expected}, 候选给出 ${mismatch.actual ?? "（缺失）"}`,
          );
          process.exitCode = 1;
        }
        break;
      }
      case "export": {
        const row = store.requireCase(needId(args));
        const format = str(args, "format") ?? "json";
        const order = store.eliminationOrder(row.id);
        let content: string;
        if (format === "json") {
          content = JSON.stringify(
            {
              id: row.id,
              params: { n: row.n, k: row.k, start: row.start },
              engineVersion: row.engine_version,
              eliminationOrder: order,
              survivor: row.survivor,
            },
            null,
            2,
          );
        } else if (format === "csv") {
          content =
            "step,eliminated\n" + order.map((e, i) => `${i + 1},${e}`).join("\n") + "\n";
        } else {
          throw new ValidationError("INVALID_FORMAT", "--format 仅支持 json 或 csv");
        }
        const out = str(args, "out");
        if (out) {
          fs.writeFileSync(path.resolve(out), content, "utf8");
          console.log(`已导出到 ${path.resolve(out)}`);
        } else {
          console.log(content);
        }
        break;
      }
      case "demo": {
        runDemo(store);
        break;
      }
      default:
        throw new ValidationError("UNKNOWN_COMMAND", `未知命令: ${cmd}\n\n${USAGE}`);
    }
  } finally {
    store.close();
  }
}

try {
  main();
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`错误 [${err.code}]: ${err.message}`);
  } else {
    console.error("内部错误:", err);
  }
  process.exit(1);
}
