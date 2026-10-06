/**
 * Fenwick 树（树状数组），维护每个原位置是否存活（1/0）。
 * 内部下标为 0-based，与 1-based 编号的转换由上层统一完成。
 */
export class Fenwick {
  private readonly tree: Int32Array;
  readonly size: number;

  constructor(n: number) {
    this.size = n;
    this.tree = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.tree[i + 1] = 1;
    }
    for (let i = 1; i <= n; i++) {
      const j = i + (i & -i);
      if (j <= n) this.tree[j] += this.tree[i];
    }
  }

  /** 前缀和：位置 <= idx（0-based）的存活数量 */
  prefixSum(idx: number): number {
    let s = 0;
    let i = idx + 1;
    while (i > 0) {
      s += this.tree[i];
      i -= i & -i;
    }
    return s;
  }

  /** 总存活数 */
  total(): number {
    return this.prefixSum(this.size - 1);
  }

  /** 将位置 idx 置为不存活（调用方保证其当前存活） */
  remove(idx: number): void {
    let i = idx + 1;
    while (i <= this.size) {
      this.tree[i] -= 1;
      i += i & -i;
    }
  }

  /** 是否存活 */
  isAlive(idx: number): boolean {
    return this.prefixSum(idx) - (idx > 0 ? this.prefixSum(idx - 1) : 0) === 1;
  }

  /** 第 k 个存活者的位置（k 为 1-based），返回 0-based 位置 */
  kthAlive(k: number): number {
    let idx = 0;
    let bit = 1;
    while (bit << 1 <= this.size) bit <<= 1;
    for (; bit > 0; bit >>= 1) {
      const next = idx + bit;
      if (next <= this.size && this.tree[next] < k) {
        k -= this.tree[next];
        idx = next;
      }
    }
    return idx;
  }

  /**
   * 位置 idx 之后（严格大于 idx）的第一个存活位置；
   * 若其后没有存活者则绕回环首。调用方保证至少一个存活者。
   */
  nextAlive(idx: number): number {
    const total = this.total();
    const after = idx + 1 < this.size ? total - this.prefixSum(idx) : 0;
    if (after > 0) {
      return this.kthAlive(this.prefixSum(idx) + 1);
    }
    return this.kthAlive(1);
  }
}
