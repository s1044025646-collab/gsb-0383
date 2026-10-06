// 供 API 层复用的导出聚合，避免循环依赖。
export {
  computeJosephus,
  parseParams,
  verifyOrder,
  ValidationError,
} from "../core/josephus";

import { ValidationError } from "../core/josephus";

/** 校验候选淘汰顺序：必须是 1..n 内不重复编号的数组 */
export function validateCandidate(raw: unknown, n: number): number[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("INVALID_CANDIDATE", "candidate 必须是编号数组");
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const item of raw) {
    const v = Number(item);
    if (!Number.isInteger(v) || v < 1 || v > n) {
      throw new ValidationError(
        "INVALID_CANDIDATE",
        `候选编号 ${item} 不是 1..${n} 内的整数`,
      );
    }
    if (seen.has(v)) {
      throw new ValidationError("INVALID_CANDIDATE", `候选编号 ${v} 重复出现`);
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}
