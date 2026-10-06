import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeJosephus,
  parseParams,
  ValidationError,
} from "../src/core/josephus";
import { CaseStore } from "../src/db/store";

function tempStore(): { store: CaseStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "josephus-test-"));
  return { store: new CaseStore(path.join(dir, "t.db")), dir };
}

test("保存后重启可读取任意步骤", () => {
  const { store, dir } = tempStore();
  const params = parseParams({ n: 7, k: "3", start: 1 });
  const result = computeJosephus(params);
  const id = store.saveResult(params, result);
  store.close();

  // 重新打开（模拟重启）
  const store2 = new CaseStore(path.join(dir, "t.db"));
  const row = store2.requireCase(id);
  assert.equal(row.survivor, 4);
  assert.deepEqual(store2.eliminationOrder(id), [3, 6, 2, 7, 5, 1]);
  const step3 = store2.getStep(id, 3);
  assert.equal(step3?.eliminated, 2);
  assert.equal(step3?.countFrom, 7);
  assert.equal(store2.totalSteps(id), 6);
  store2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("labelStatus: r=0 无人淘汰；r>=n-1 仅幸存者存活", () => {
  const { store, dir } = tempStore();
  const params = parseParams({ n: 7, k: "3", start: 1 });
  const id = store.saveResult(params, computeJosephus(params));
  const row = store.requireCase(id);

  // r = 0：没有任何淘汰
  assert.equal(store.labelStatus(row, 3, 0).eliminated, false);
  // r = 1：只有 3 被淘汰
  assert.equal(store.labelStatus(row, 3, 1).eliminated, true);
  assert.equal(store.labelStatus(row, 6, 1).eliminated, false);
  // r = n-1 = 6：除幸存者 4 外全部淘汰
  for (let label = 1; label <= 7; label++) {
    const st = store.labelStatus(row, label, 6);
    assert.equal(st.eliminated, label !== 4, `label=${label}`);
  }
  // 幸存者永远没有 eliminatedAt
  assert.equal(store.labelStatus(row, 4, 100).eliminatedAt, null);
  // 越界 label 报错
  assert.throws(
    () => store.labelStatus(row, 8, 0),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_LABEL",
  );
  assert.throws(
    () => store.labelStatus(row, 1, -1),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_R",
  );
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("分页读取步骤", () => {
  const { store, dir } = tempStore();
  const params = parseParams({ n: 100, k: "7", start: 1 });
  const id = store.saveResult(params, computeJosephus(params));
  const page1 = store.getSteps(id, 10, 0);
  const page2 = store.getSteps(id, 10, 10);
  assert.equal(page1.length, 10);
  assert.equal(page1[0].step, 1);
  assert.equal(page2[0].step, 11);
  assert.equal(store.totalSteps(id), 99);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
