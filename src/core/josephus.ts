import { Fenwick } from "./fenwick";

export const MAX_N = 20000;
export const ENGINE_VERSION = "1.0.0";

export interface JosephusParams {
  n: number;
  /** k 的十进制字符串，正整数，可超过安全整数 */
  k: string;
  /** 起点编号，1-based，1 <= start <= n；起点本人算“一” */
  start: number;
}

export interface StepRecord {
  /** 第几次淘汰，1-based */
  step: number;
  /** 本轮报数起点编号（1-based） */
  countFrom: number;
  /** 本轮开始时存活人数 */
  aliveCount: number;
  /** 有效移动步数 (k-1) mod aliveCount */
  effectiveMove: number;
  /** 被淘汰者编号（1-based） */
  eliminated: number;
  /** 下一轮报数起点编号；最后一步为 null */
  nextStart: number | null;
  /** 本轮结束后剩余人数 */
  remaining: number;
}

export interface JosephusResult {
  params: JosephusParams;
  steps: StepRecord[];
  eliminationOrder: number[];
  survivor: number;
}

export class ValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function parseParams(input: {
  n: unknown;
  k: unknown;
  start: unknown;
}): JosephusParams {
  const nRaw = input.n;
  const n =
    typeof nRaw === "string" && /^\d+$/.test(nRaw.trim())
      ? Number(nRaw.trim())
      : typeof nRaw === "number"
        ? nRaw
        : NaN;
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError("INVALID_N", "n 必须是 >= 1 的整数");
  }
  if (n > MAX_N) {
    throw new ValidationError("N_TOO_LARGE", `n 不能超过 ${MAX_N}`);
  }

  const kStr = String(input.k ?? "").trim();
  if (!/^[0-9]+$/.test(kStr)) {
    throw new ValidationError("INVALID_K", "k 必须是正整数十进制字符串");
  }
  const kBig = BigInt(kStr);
  if (kBig < 1n) {
    throw new ValidationError("INVALID_K", "k 必须是 >= 1 的正整数");
  }

  const sRaw = input.start;
  const start =
    typeof sRaw === "string" && /^\d+$/.test(sRaw.trim())
      ? Number(sRaw.trim())
      : typeof sRaw === "number"
        ? sRaw
        : NaN;
  if (!Number.isInteger(start) || start < 1 || start > n) {
    throw new ValidationError(
      "INVALID_START",
      `start 必须是 1..${n} 之间的整数（起点本人算一）`,
    );
  }
  return { n, k: kBig.toString(10), start };
}

/**
 * 完整计算约瑟夫环淘汰序列。
 * 使用 Fenwick 树维护存活标记，每步 O(log n)，不逐人报数。
 * 所有对外编号为 1-based；内部位置为 0-based，仅在边界处转换。
 */
export function computeJosephus(params: JosephusParams): JosephusResult {
  const { n, start } = params;
  const k = BigInt(params.k);
  const steps: StepRecord[] = [];
  const eliminationOrder: number[] = [];

  if (n === 1) {
    return { params, steps, eliminationOrder, survivor: 1 };
  }

  const fw = new Fenwick(n);
  let current = start - 1; // 0-based，当前报数起点（本人算一）
  let alive = n;

  while (alive > 1) {
    const move = Number((k - 1n) % BigInt(alive)); // 存活者次序上的有效移动步数
    const rank = fw.prefixSum(current); // 当前起点在存活者中的名次（1-based）
    const targetRank = ((rank - 1 + move) % alive) + 1;
    const target = fw.kthAlive(targetRank);

    fw.remove(target);
    const remaining = alive - 1;
    const nextStart = remaining > 1 ? fw.nextAlive(target) : null;

    steps.push({
      step: steps.length + 1,
      countFrom: current + 1,
      aliveCount: alive,
      effectiveMove: move,
      eliminated: target + 1,
      nextStart: nextStart === null ? null : nextStart + 1,
      remaining,
    });
    eliminationOrder.push(target + 1);

    if (nextStart !== null) {
      current = nextStart;
    }
    alive = remaining;
  }

  const survivor = fw.kthAlive(1) + 1;
  return { params, steps, eliminationOrder, survivor };
}

/** 朴素逐人报数基准实现（仅用于小 n 测试对照） */
export function computeJosephusNaive(params: JosephusParams): number[] {
  const { n, start } = params;
  const k = BigInt(params.k);
  const aliveArr = Array.from({ length: n }, (_, i) => i + 1);
  const eliminationOrder: number[] = [];
  let idx = start - 1;
  while (aliveArr.length > 1) {
    const move = Number((k - 1n) % BigInt(aliveArr.length));
    idx = (idx + move) % aliveArr.length;
    eliminationOrder.push(aliveArr[idx]);
    aliveArr.splice(idx, 1);
    if (idx >= aliveArr.length) idx = 0;
  }
  return eliminationOrder;
}

/**
 * 幸存者递推（仅适用于起点为 1 的情形），用于测试核对。
 * J(1)=0；J(m)=(J(m-1)+k) mod m；返回 1-based 编号。
 */
export function survivorByRecurrence(n: number, k: string): number {
  const kBig = BigInt(k);
  let j = 0n;
  for (let m = 2; m <= n; m++) {
    j = (j + kBig) % BigInt(m);
  }
  return Number(j) + 1;
}

export interface VerifyMismatch {
  step: number;
  aliveCount: number;
  expected: number;
  actual: number | null;
}

/**
 * 核验用户提供的候选淘汰顺序是否符合规则。
 * 完整重算后逐步比对；返回首个不符步骤，全部一致返回 null。
 */
export function verifyOrder(
  params: JosephusParams,
  candidate: number[],
): VerifyMismatch | null {
  const result = computeJosephus(params);
  const expected = result.eliminationOrder;
  const len = Math.max(candidate.length, expected.length);
  for (let i = 0; i < len; i++) {
    const actual = i < candidate.length ? candidate[i] : null;
    const exp = i < expected.length ? expected[i] : null;
    if (actual !== exp) {
      const stepInfo = result.steps[i];
      return {
        step: i + 1,
        aliveCount: stepInfo ? stepInfo.aliveCount : 1,
        expected: exp === null ? -1 : exp,
        actual,
      };
    }
  }
  return null;
}
