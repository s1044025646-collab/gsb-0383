export const ENGINE_VERSION = "josephus-fenwick-1.0.0";
export const MAX_N = 20000;
export const MAX_K_DIGITS = 100;

export type JosephusInput = {
  n: number;
  k: string;
  start: number;
};

export type JosephusStep = {
  step: number;
  startLabel: number;
  aliveCount: number;
  moves: number;
  eliminated: number;
  nextStartLabel: number;
  remaining: number;
};

export type JosephusResult = JosephusInput & {
  engineVersion: string;
  eliminationOrder: number[];
  survivor: number;
  steps: JosephusStep[];
};

export type ValidationIssue = {
  code: string;
  message: string;
};

export type CandidateMismatch = {
  ok: false;
  failedStep: number;
  aliveCount: number;
  received: number;
  expected: number;
  message: string;
};

export type CandidateCheck =
  | { ok: true }
  | CandidateMismatch
  | { ok: false; code: string; message: string };

export class FenwickTree {
  private readonly tree: number[];

  constructor(private readonly size: number) {
    this.tree = new Array(size + 1).fill(0);
    for (let index = 0; index < size; index += 1) {
      this.add(index, 1);
    }
  }

  add(zeroIndex: number, delta: number): void {
    for (let index = zeroIndex + 1; index <= this.size; index += index & -index) {
      const currentValue = this.tree[index] ?? 0;
      this.tree[index] = currentValue + delta;
    }
  }

  prefixCount(zeroIndexExclusive: number): number {
    let total = 0;
    for (let index = zeroIndexExclusive; index > 0; index -= index & -index) {
      total += this.tree[index]!;
    }
    return total;
  }

  kth(oneBasedRank: number): number {
    if (oneBasedRank < 1 || oneBasedRank > this.prefixCount(this.size)) {
      throw new RangeError("存活者排名超出范围");
    }

    let index = 0;
    let highestPower = 1;
    while (highestPower << 1 <= this.size) {
      highestPower <<= 1;
    }

    let remainingRank = oneBasedRank;
    for (let stepLength = highestPower; stepLength > 0; stepLength >>= 1) {
      const nextIndex = index + stepLength;
      if (nextIndex <= this.size && this.tree[nextIndex]! < remainingRank) {
        index = nextIndex;
        remainingRank -= this.tree[nextIndex]!;
      }
    }

 return index;
  }

  aliveCount(): number {
    return this.prefixCount(this.size);
  }
}

export function normalizeDecimalK(k: string): string {
  if (typeof k !== "string") {
    throw Object.assign(new Error("k 必须是十进制字符串"), { code: "INVALID_K" });
  }
  const trimmed = k.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw Object.assign(new Error("k 必须是无符号十进制正整数字符串"), { code: "INVALID_K" });
  }
  const normalized = trimmed.replace(/^0+(?=\d)/, "");
  if (normalized === "0") {
    throw Object.assign(new Error("k 必须大于零"), { code: "INVALID_K" });
  }
  if (normalized.length > MAX_K_DIGITS) {
    throw Object.assign(new Error(`k 最多允许 ${MAX_K_DIGITS} 位十进制数字`), {
      code: "INVALID_K"
    });
  }
  return normalized;
}

export function validateInput(input: {
  n: unknown;
  k: unknown;
  start: unknown;
}): JosephusInput {
  if (!Number.isInteger(input.n) || (input.n as number) < 1 || (input.n as number) > MAX_N) {
    throw Object.assign(new Error(`n 必须是 1 到 ${MAX_N} 的整数`), { code: "INVALID_N" });
  }

  const n = input.n as number;
  const k = normalizeDecimalK(input.k as string);

  if (
    !Number.isInteger(input.start) ||
    (input.start as number) < 1 ||
    (input.start as number) > n
  ) {
    throw Object.assign(new Error("start 必须是原环中 1 到 n 的有效编号"), {
      code: "INVALID_START"
    });
  }

  return { n, k, start: input.start as number };
}

export function computeJosephus(input: {
  n: unknown;
  k: unknown;
  start: unknown;
}): JosephusResult {
  const normalized = validateInput(input);
  const { n, k } = normalized;
  const kBig = BigInt(k);
  const fenwick = new FenwickTree(n);
  const steps: JosephusStep[] = [];
  const eliminationOrder: number[] = [];

  let startRank = normalized.start - 1;

  for (let aliveCount = n; aliveCount > 1; aliveCount -= 1) {
    const moves = Number((kBig - 1n) % BigInt(aliveCount));
    const targetRank = (startRank + moves) % aliveCount;
    const startIndex = fenwick.kth(startRank + 1);
    const targetIndex = fenwick.kth(targetRank + 1);
    const eliminated = targetIndex + 1;

    fenwick.add(targetIndex, -1);
    const remaining = aliveCount - 1;
    const nextStartRank = remaining === 0 ? 0 : targetRank % remaining;
    const nextStartIndex = remaining === 0 ? targetIndex : fenwick.kth(nextStartRank + 1);

    const step: JosephusStep = {
      step: n - remaining,
      startLabel: startIndex + 1,
      aliveCount,
      moves,
      eliminated,
      nextStartLabel: nextStartIndex + 1,
      remaining
    };

    steps.push(step);
    eliminationOrder.push(eliminated);
    startRank = nextStartRank;
  }

  const survivor = n === 1 ? normalized.start : fenwick.kth(1) + 1;

  return {
    ...normalized,
    engineVersion: ENGINE_VERSION,
    eliminationOrder,
    survivor,
    steps
  };
}

export function validateThroughRange(n: number, through: unknown): number {
  if (!Number.isInteger(through) || (through as number) < 0 || (through as number) > n - 1) {
    throw Object.assign(new Error(`through 必须是 0 到 ${n - 1} 的整数`), {
      code: "INVALID_STEP"
    });
  }
  return through as number;
}

export function validateLabel(n: number, label: unknown): number {
  if (!Number.isInteger(label) || (label as number) < 1 || (label as number) > n) {
    throw Object.assign(new Error(`编号必须是 1 到 ${n} 的整数`), {
      code: "INVALID_POSITION"
    });
  }
  return label as number;
}

export function verifyCandidate(result: JosephusResult, candidate: unknown): CandidateCheck {
  if (!Array.isArray(candidate) || candidate.some((value) => !Number.isInteger(value))) {
    return {
      ok: false,
      code: "INVALID_CANDIDATE",
      message: "候选淘汰顺序必须是整数数组"
    };
  }

  if (candidate.length !== result.n - 1) {
    return {
      ok: false,
      code: "INVALID_CANDIDATE",
      message: `候选淘汰顺序长度必须为 ${result.n - 1}`
    };
  }

  for (const [index, received] of candidate.entries()) {
    const expected = result.eliminationOrder[index]!;
    if (received !== expected) {
      const step = index + 1;
      const stepRecord = result.steps[index]!;
      return {
        ok: false,
        failedStep: step,
        aliveCount: stepRecord.aliveCount,
        received: received as number,
        expected,
        message: `第 ${step} 步不匹配：当时有 ${stepRecord.aliveCount} 人，应淘汰 ${expected}，候选为 ${received}`
      };
    }
  }

  return { ok: true };
}

export function naiveJosephus(n: number, k: bigint, start: number): number[] {
  const alive = Array.from({ length: n }, (_, index) => index + 1);
  const order: number[] = [];
  let current = start - 1;

  while (alive.length > 1) {
    const moves = Number((k - 1n) % BigInt(alive.length));
    current = (current + moves) % alive.length;
    order.push(alive[current]!);
    alive.splice(current, 1);
    if (alive.length > 0) {
      current %= alive.length;
    }
  }

  return order;
}

export function survivorFromOne(n: number, k: bigint): number {
  let survivorZeroBased = 0;
  for (let aliveCount = 2; aliveCount <= n; aliveCount += 1) {
    survivorZeroBased =
      (survivorZeroBased + Number((k - 1n) % BigInt(aliveCount)) + 1) % aliveCount;
  }
  return survivorZeroBased + 1;
}

export function assertEveryLabelOnce(result: JosephusResult): void {
  const labels = [...result.eliminationOrder, result.survivor].sort((a, b) => a - b);
  const expected = Array.from({ length: result.n }, (_, index) => index + 1);
  if (labels.length !== expected.length || labels.some((label, index) => label !== expected[index])) {
    throw new Error("结果未让每个编号恰好出现一次");
  }
}

