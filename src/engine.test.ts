import { describe, expect, it } from "vitest";
import {
  assertEveryLabelOnce,
  computeJosephus,
  naiveJosephus,
  survivorFromOne,
  verifyCandidate
} from "./engine.js";

describe("约瑟夫环 Fenwick 计算", () => {
  it("计算 n=7 k=3 从 1 开始的标准序列", () => {
    const result = computeJosephus({ n: 7, k: "3", start: 1 });
    expect(result.eliminationOrder).toEqual([3, 6, 2, 7, 5, 1]);
    expect(result.survivor).toBe(4);
    expect(result.steps.map((step) => step.moves)).toEqual([2, 2, 2, 2, 2, 0]);
    expect(result.steps.at(-1)).toMatchObject({
      aliveCount: 2,
      remaining: 1,
      nextStartLabel: 4
    });
    assertEveryLabelOnce(result);
  });

  it("支持 n=1 且不产生淘汰步骤", () => {
    const result = computeJosephus({ n: 1, k: "999999999999999999999999", start: 1 });
    expect(result.eliminationOrder).toEqual([]);
    expect(result.steps).toEqual([]);
    expect(result.survivor).toBe(1);
  });

  it("支持 k=1 时依次淘汰当前报数者", () => {
    const result = computeJosephus({ n: 5, k: "1", start: 3 });
    expect(result.eliminationOrder).toEqual([3, 4, 5, 1]);
    expect(result.survivor).toBe(2);
    expect(result.steps.every((step) => step.moves === 0)).toBe(true);
  });

  it("支持起点在尾部和 k 为当前人数倍数时绕回", () => {
    const result = computeJosephus({ n: 4, k: "4", start: 4 });
    expect(result.eliminationOrder).toEqual([3, 4, 2]);
    expect(result.survivor).toBe(1);
    expect(result.steps[0]).toMatchObject({ startLabel: 4, moves: 3, eliminated: 3, nextStartLabel: 4 });
    expect(result.steps[1]).toMatchObject({ startLabel: 4, aliveCount: 3, moves: 0, eliminated: 4, nextStartLabel: 1 });
  });

  it("对超大 k 使用 BigInt 取模而不逐次循环", () => {
    const hugeK = "987654321987654321987654321987654321987654321987654321";
    const result = computeJosephus({ n: 20000, k: hugeK, start: 20000 });
    const expectedOrder = naiveJosephus(20000, BigInt(hugeK), 20000);
    expect(result.eliminationOrder).toEqual(expectedOrder);
    expect(result.steps.every((step) => step.moves < step.aliveCount)).toBe(true);
    expect(result.survivor).toBe(expectedOrder.length === 0 ? 20000 : result.survivor);
    assertEveryLabelOnce(result);
  });

  it("对一批小规模输入与独立数组模拟一致", () => {
    for (let n = 1; n <= 30; n += 1) {
      for (let start = 1; start <= n; start += 1) {
        for (const k of ["1", "2", "3", "7", "300", "999999999999999999999999"]) {
          const result = computeJosephus({ n, k, start });
          expect(result.eliminationOrder).toEqual(naiveJosephus(n, BigInt(k), start));
          assertEveryLabelOnce(result);
        }
      }
    }
  });

  it("用幸存者递推核对从 1 开始的最终编号", () => {
    for (const [n, kText] of [
      [7, "3"],
      [100, "9"],
      [1234, "5678901234567890123456789"],
      [20000, "42"]
    ] as const) {
      expect(computeJosephus({ n, k: kText, start: 1 }).survivor).toBe(
        survivorFromOne(n, BigInt(kText))
      );
    }
  });

  it("旋转默认起点时逐步编号同步旋转", () => {
    const base = computeJosephus({ n: 8, k: "5", start: 1 });
    const shifted = computeJosephus({ n: 8, k: "5", start: 6 });
    const rotate = (label: number): number => ((label - 1 + 5) % 8) + 1;
    expect(shifted.eliminationOrder).toEqual(base.eliminationOrder.map(rotate));
    expect(shifted.survivor).toBe(rotate(base.survivor));
  });

  it("核验候选顺序时指出首个不匹配步骤的正确人数和应淘汰者", () => {
    const result = computeJosephus({ n: 7, k: "3", start: 1 });
    expect(verifyCandidate(result, [3, 6, 2, 7, 5, 1])).toEqual({ ok: true });
    expect(verifyCandidate(result, [3, 5, 2, 7, 5, 1])).toMatchObject({
      ok: false,
      failedStep: 2,
      aliveCount: 6,
      received: 5,
      expected: 6
    });
  });

  it("拒绝非法参数", () => {
    expect(() => computeJosephus({ n: 0, k: "1", start: 1 })).toThrow("n");
    expect(() => computeJosephus({ n: 7, k: "0", start: 1 })).toThrow("k");
    expect(() => computeJosephus({ n: 7, k: "1.5", start: 1 })).toThrow("k");
    expect(() => computeJosephus({ n: 7, k: "1", start: 8 })).toThrow("start");
  });
});
