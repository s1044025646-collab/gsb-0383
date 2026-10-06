import test from "node:test";
import assert from "node:assert/strict";
import {
  computeJosephus,
  computeJosephusNaive,
  parseParams,
  survivorByRecurrence,
  verifyOrder,
  ValidationError,
  MAX_N,
} from "../src/core/josephus";

const P = (n: number, k: string | number, start: number) =>
  parseParams({ n, k: String(k), start });

const hasCode = (code: string) => (e: unknown) =>
  e instanceof ValidationError && e.code === code;

test("演示: n=7, k=3, start=1 => 淘汰 3,6,2,7,5,1 幸存 4", () => {
  const r = computeJosephus(P(7, 3, 1));
  assert.deepEqual(r.eliminationOrder, [3, 6, 2, 7, 5, 1]);
  assert.equal(r.survivor, 4);
  assert.equal(r.steps.length, 6);
  // 第一步：从 1 开始，7 人，有效移动 2，淘汰 3，下一起点 4
  assert.deepEqual(r.steps[0], {
    step: 1,
    countFrom: 1,
    aliveCount: 7,
    effectiveMove: 2,
    eliminated: 3,
    nextStart: 4,
    remaining: 6,
  });
  // 最后一步没有下一起点
  assert.equal(r.steps[5].nextStart, null);
  assert.equal(r.steps[5].remaining, 1);
});

test("n=1: 无淘汰动作，唯一编号幸存", () => {
  const r = computeJosephus(P(1, 5, 1));
  assert.deepEqual(r.eliminationOrder, []);
  assert.equal(r.survivor, 1);
  assert.equal(r.steps.length, 0);
});

test("k=1: 依次淘汰当前报数者", () => {
  const r = computeJosephus(P(5, 1, 1));
  assert.deepEqual(r.eliminationOrder, [1, 2, 3, 4]);
  assert.equal(r.survivor, 5);
  for (const s of r.steps) assert.equal(s.effectiveMove, 0);
});

test("起点在尾部: start=n 时起点本人算一", () => {
  // n=5, k=2, start=5：从 5 数一，淘汰 1
  const r = computeJosephus(P(5, 2, 5));
  assert.equal(r.steps[0].countFrom, 5);
  assert.equal(r.steps[0].eliminated, 1);
  assert.deepEqual(r.eliminationOrder, computeJosephusNaive(P(5, 2, 5)));
});

test("k 恰为当前人数倍数: 淘汰报数起点的前一人", () => {
  // n=4, k=4, start=1：第一轮 (k-1)%4=3，从 1 移动 3 步淘汰 4
  const r = computeJosephus(P(4, 4, 1));
  assert.equal(r.steps[0].effectiveMove, 3);
  assert.equal(r.steps[0].eliminated, 4);
  assert.deepEqual(r.eliminationOrder, computeJosephusNaive(P(4, 4, 1)));
});

test("超大 k: 取模跳步，与朴素实现一致", () => {
  const bigK = "123456789012345678901234567890";
  const params = P(97, bigK, 13);
  const r = computeJosephus(params);
  assert.deepEqual(r.eliminationOrder, computeJosephusNaive(params));
  assert.equal(r.steps[0].effectiveMove, Number((BigInt(bigK) - 1n) % 97n));
});

test("小 n 全面对照朴素逐人报数基准", () => {
  for (let n = 1; n <= 30; n++) {
    for (const k of [1, 2, 3, 7, 100]) {
      for (let start = 1; start <= n; start++) {
        const params = P(n, k, start);
        const fast = computeJosephus(params);
        const naive = computeJosephusNaive(params);
        assert.deepEqual(
          fast.eliminationOrder,
          naive,
          `n=${n} k=${k} start=${start}`,
        );
        const naiveSurvivorSet = new Set(naive);
        for (let label = 1; label <= n; label++) {
          if (!naiveSurvivorSet.has(label)) {
            assert.equal(fast.survivor, label);
          }
        }
      }
    }
  }
});

test("幸存者递推核对（start=1）", () => {
  for (const [n, k] of [
    [7, "3"],
    [41, "3"],
    [100, "999999999999999999"],
    [1, "1"],
  ] as Array<[number, string]>) {
    const r = computeJosephus(P(n, k, 1));
    assert.equal(r.survivor, survivorByRecurrence(n, k), `n=${n} k=${k}`);
  }
});

test("每个编号恰好作为淘汰者或幸存者出现一次", () => {
  const r = computeJosephus(P(2000, "987654321987654321", 777));
  const seen = new Set(r.eliminationOrder);
  assert.equal(seen.size, r.eliminationOrder.length);
  assert.equal(seen.size, 1999);
  assert.ok(!seen.has(r.survivor));
  assert.ok(r.survivor >= 1 && r.survivor <= 2000);
});

test("旋转起点得到相应旋转编号", () => {
  // 起点平移 s-1 等价于所有对外编号平移 s-1（模 n）
  const n = 11;
  const k = "4";
  const base = computeJosephus(P(n, k, 1));
  const s = 4;
  const rot = computeJosephus(P(n, k, s));
  const shift = (x: number) => ((x - 1 + (s - 1)) % n) + 1;
  assert.deepEqual(rot.eliminationOrder, base.eliminationOrder.map(shift));
  assert.equal(rot.survivor, shift(base.survivor));
});

test("逐步记录自洽: 下一起点是淘汰者的存活后继", () => {
  const r = computeJosephus(P(10, 3, 2));
  for (let i = 0; i + 1 < r.steps.length; i++) {
    assert.equal(r.steps[i + 1].countFrom, r.steps[i].nextStart);
    assert.equal(r.steps[i].remaining, r.steps[i].aliveCount - 1);
  }
});

test("verifyOrder: 正确候选通过，篡改首步即报出正确人数与应淘汰者", () => {
  const params = P(7, 3, 1);
  assert.equal(verifyOrder(params, [3, 6, 2, 7, 5, 1]), null);
  const bad = verifyOrder(params, [2, 6, 3, 7, 5, 1]);
  assert.deepEqual(bad, { step: 1, aliveCount: 7, expected: 3, actual: 2 });
  // 长度不足也算不符
  const short = verifyOrder(params, [3, 6, 2]);
  assert.equal(short?.step, 4);
  assert.equal(short?.actual, null);
});

test("参数校验错误码", () => {
  assert.throws(() => parseParams({ n: 0, k: "1", start: 1 }), hasCode("INVALID_N"));
  assert.throws(
    () => parseParams({ n: MAX_N + 1, k: "1", start: 1 }),
    hasCode("N_TOO_LARGE"),
  );
  assert.throws(() => parseParams({ n: 5, k: "0", start: 1 }), hasCode("INVALID_K"));
  assert.throws(() => parseParams({ n: 5, k: "abc", start: 1 }), hasCode("INVALID_K"));
  assert.throws(() => parseParams({ n: 5, k: "1", start: 6 }), hasCode("INVALID_START"));
  assert.throws(() => parseParams({ n: 5, k: "1", start: 0 }), hasCode("INVALID_START"));
  assert.ok(
    parseParams({ n: 5, k: "1", start: 5 }) instanceof Object,
  );
  assert.throws(
    () => parseParams({ n: 5, k: "1.5", start: 1 }),
    ValidationError,
  );
});

