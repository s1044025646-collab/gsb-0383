import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JosephusStore } from "./store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()!;
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeStore(): JosephusStore {
  const directory = mkdtempSync(join(tmpdir(), "josephus-"));
  tempDirs.push(directory);
  const store = new JosephusStore(join(directory, "case.sqlite"));
  stores.push(store);
  return store;
}

const stores: JosephusStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()!.close();
  }
});

describe("SQLite 持久化", () => {
  it("保存算例并在重新打开后读取任意步骤", () => {
    const directory = mkdtempSync(join(tmpdir(), "josephus-"));
    tempDirs.push(directory);
    const databasePath = join(directory, "case.sqlite");

    const firstStore = new JosephusStore(databasePath);
    const created = firstStore.createCase({ n: 7, k: "3", start: 1 });
    firstStore.close();

    const reopened = new JosephusStore(databasePath);
    const loaded = reopened.getCase(created.id);
    expect(loaded?.eliminationOrder).toEqual([3, 6, 2, 7, 5, 1]);
    expect(loaded?.survivor).toBe(4);
    expect(reopened.getStep(created.id, 1)).toMatchObject({
      startLabel: 1,
      aliveCount: 7,
      moves: 2,
      eliminated: 3,
      nextStartLabel: 4,
      remaining: 6
    });
    expect(reopened.getSteps(created.id, { limit: 2, offset: 2 }).steps.map((s) => s.eliminated)).toEqual([2, 7]);
    reopened.close();
  });

  it("定义 r=0 与全部淘汰后的编号状态查询边界", () => {
    const store = makeStore();
    const created = store.createCase({ n: 4, k: "2", start: 1 });

    expect(store.getPositionStatus(created.id, 2, 0)).toMatchObject({
      label: 2,
      through: 0,
      eliminated: false,
      eliminationStep: 1
    });
    expect(store.getPositionStatus(created.id, 1, 3)).toMatchObject({
      eliminated: false,
      eliminationStep: null,
      survivor: true
    });
    expect(store.getPositionStatus(created.id, 3, 3)).toMatchObject({
      eliminated: true,
      eliminationStep: 3,
      survivor: false
    });
  });

  it("计算失败时不发布算例", () => {
    const store = makeStore();
    expect(() => store.createCase({ n: 4, k: "0", start: 1 })).toThrow();
    expect(store.listCases()).toEqual([]);
  });
});
