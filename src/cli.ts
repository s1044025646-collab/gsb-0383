import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JosephusStore } from "./store.js";
import {
  assertEveryLabelOnce,
  computeJosephus,
  naiveJosephus,
  survivorFromOne,
  verifyCandidate
} from "./engine.js";

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("--")) {
      throw Object.assign(new Error(`无法识别参数 ${token}`), { code: "INVALID_ARGUMENT" });
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw Object.assign(new Error(`参数 --${key} 缺少值`), { code: "INVALID_ARGUMENT" });
    }
    flags.set(key, value);
    index += 1;
  }
  return flags;
}

function openStore(): JosephusStore {
  const here = dirname(fileURLToPath(import.meta.url));
  const databasePath = process.env.JOSEPHUS_DB
    ? resolve(process.cwd(), process.env.JOSEPHUS_DB)
    : resolve(here, "..", "data", "josephus.sqlite");
  return new JosephusStore(databasePath);
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function requireId(flags: Map<string, string>): string {
  const id = flags.get("id");
  if (!id) throw Object.assign(new Error("必须提供 --id"), { code: "INVALID_ARGUMENT" });
  return id;
}

function demo(): void {
  const standard = computeJosephus({ n: 7, k: "3", start: 1 });
  const hugeK = "987654321987654321987654321987654321987654321987654321";
  const huge = computeJosephus({ n: 12, k: hugeK, start: 12 });
  const naive = naiveJosephus(7, 3n, 1);
  const recurrenceSurvivor = survivorFromOne(7, 3n);

  print({
    standard,
    expected: {
      eliminationOrder: [3, 6, 2, 7, 5, 1],
      survivor: 4
    },
    independentChecks: {
      naiveOrder: naive,
      recurrenceSurvivor
    },
    largeKModuloDemo: {
      n: 12,
      k: hugeK,
      start: 12,
      firstStep: huge.steps[0],
      eliminationOrder: huge.eliminationOrder,
      survivor: huge.survivor
    }
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!command || command === "demo") {
    demo();
    return;
  }

  const store = openStore();
  try {
    if (command === "create") {
      const created = store.createCase({
        n: Number(flags.get("n")),
        k: flags.get("k") ?? "",
        start: Number(flags.get("start"))
      });
      assertEveryLabelOnce(created);
      print(created);
      return;
    }

    if (command === "list") {
      print({ cases: store.listCases() });
      return;
    }

    const id = requireId(flags);
    const current = store.getCase(id);
    if (!current) {
      throw Object.assign(new Error("算例不存在"), { code: "NOT_FOUND" });
    }

    if (command === "get") {
      print(current);
    } else if (command === "steps") {
      const limit = Number(flags.get("limit") ?? "100");
      const offset = Number(flags.get("offset") ?? "0");
      print(store.getSteps(id, { limit, offset }));
    } else if (command === "step") {
      const stepNumber = Number(flags.get("r"));
      if (stepNumber === 0) {
        print({
          boundary: "BEFORE_ELIMINATIONS",
          message: "r=0 表示尚未发生淘汰",
          step: null
        });
      } else {
        print(store.getStep(id, stepNumber));
      }
    } else if (command === "position") {
      print(
        store.getPositionStatus(
          id,
          Number(flags.get("label")),
          Number(flags.get("through") ?? current.n - 1)
        )
      );
    } else if (command === "verify") {
      const raw = flags.get("candidate") ?? "";
      const candidate = raw.startsWith("[") ? JSON.parse(raw) : raw.split(",").map(Number);
      print(verifyCandidate(current, candidate));
    } else if (command === "compare") {
      const compareStart = Number(flags.get("start"));
      const compared = computeJosephus({ n: current.n, k: current.k, start: compareStart });
      print({
        base: {
          start: current.start,
          eliminationOrder: current.eliminationOrder,
          survivor: current.survivor
        },
        compared: {
          start: compared.start,
          eliminationOrder: compared.eliminationOrder,
          survivor: compared.survivor
        }
      });
    } else if (command === "export") {
      print({ format: "josephus-case-v1", exportedAt: new Date().toISOString(), case: current });
    } else {
      throw Object.assign(new Error(`未知命令 ${command}`), { code: "INVALID_ARGUMENT" });
    }
  } finally {
    store.close();
  }
}

main().catch((error: Error & { code?: string }) => {
  console.error(JSON.stringify({ code: error.code ?? "INTERNAL_ERROR", message: error.message }, null, 2));
  process.exitCode = 1;
});
