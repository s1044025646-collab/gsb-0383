# 约瑟夫环报数淘汰与存活顺序解释后端

使用 TypeScript + Node.js + SQLite（better-sqlite3）实现的本地后端，提供 HTTP API 与 CLI。
只做确定性序列计算，不用于随机抽奖或公平席位分配；不支持复活、动态步长或多人同时移除。

## 规则定义

- 编号 `1..n` 的人排成圆环，从起点 `start` 开始报数，**起点本人算一**。
- 每数到第 `k` 个人将其移出，从其下一个仍存活者重新数一，直到只剩一人。
- 当前存活 `m` 人时，在**存活者次序**上移动 `(k-1) mod m` 步（不是对原编号取模）。
- 所有对外编号从 1 开始；内部使用 0-based 索引，仅在边界处转换。

## 输入规模限制

- `n`：1 到 20000 的整数（`MAX_N`）。
- `k`：正整数十进制字符串，内部用 BigInt 处理，可远大于 n 和安全整数，按 `(k-1) mod m` 取模跳步，不逐人报数。
- `start`：1 到 n 的整数。

## 环境要求

- Windows 本地，Node.js 18+（开发用 Node 22 验证）。不依赖 Docker、WSL 或任何在线服务。

## 安装 / 构建 / 测试 / 启动

```powershell
npm install        # 安装依赖（better-sqlite3 为预编译原生模块）
npm run build      # 编译 TypeScript 到 dist/
npm test           # 运行全部测试（node:test + tsx）
npm start          # 启动 HTTP 服务（默认自动选择空闲端口；PORT=8080 可指定）
npm run demo       # 运行内置演示（n=7,k=3 与 k=10^30）
```

数据保存在项目内 `data/josephus.db`（可用环境变量 `JOSEPHUS_DB` 改路径）。
计算结果在单个事务中写入：计算或写入失败不会留下不完整报告；成功后重启可继续查询任意步骤。

## 完整回放示例（n=7, k=3, start=1）

`npm run demo` 输出：

```
第 1 步: 从 1 开始报数, 当时 7 人, 有效移动 2 步, 淘汰 3, 下一起点 4, 剩余 6 人
第 2 步: 从 4 开始报数, 当时 6 人, 有效移动 2 步, 淘汰 6, 下一起点 7, 剩余 5 人
第 3 步: 从 7 开始报数, 当时 5 人, 有效移动 2 步, 淘汰 2, 下一起点 4, 剩余 4 人
第 4 步: 从 4 开始报数, 当时 4 人, 有效移动 2 步, 淘汰 7, 下一起点 1, 剩余 3 人
第 5 步: 从 1 开始报数, 当时 3 人, 有效移动 2 步, 淘汰 5, 下一起点 1, 剩余 2 人
第 6 步: 从 1 开始报数, 当时 2 人, 有效移动 0 步, 淘汰 1, 下一起点 无（已结束）, 剩余 1 人
淘汰顺序: 3, 6, 2, 7, 5, 1
幸存者: 4
```

演示 2 使用 `k = 10^30`：第一步有效移动 `(10^30 - 1) mod 7 = 0` 步，直接淘汰起点 1，
展示取模跳步而非漫长循环。

## HTTP API

统一返回 `{ "ok": true, "data": ... }`；错误返回 `{ "ok": false, "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/cases` | 新建算例并完整计算，body: `{n, k, start}` |
| GET | `/api/cases?limit&offset` | 算例列表（分页） |
| GET | `/api/cases/:id` | 算例概要（参数、引擎版本、幸存者） |
| GET | `/api/cases/:id/result` | 完整淘汰顺序与幸存者 |
| GET | `/api/cases/:id/steps?limit&offset` | 逐步解释（分页） |
| GET | `/api/cases/:id/steps/:r` | 第 r 次淘汰详情 |
| GET | `/api/cases/:id/labels/:label?r=R` | 编号 label 在前 R 步内是否已淘汰 |
| POST | `/api/compare` | 比较不同起点，body: `{n, k, starts: [...]}` |
| POST | `/api/verify` | 核验候选淘汰顺序，body: `{n, k, start, candidate: [...]}` |

边界定义：`r=0` 表示尚未发生任何淘汰（所有人存活）；`r >= n-1` 时除幸存者外全部已淘汰。
核验接口在首个不符步骤返回该步正确存活人数与应淘汰者。

错误码：`INVALID_N` / `N_TOO_LARGE` / `INVALID_K` / `INVALID_START` / `INVALID_ID` /
`INVALID_R` / `INVALID_LABEL` / `INVALID_CANDIDATE` / `INVALID_PAGINATION` /
`CASE_NOT_FOUND` / `STEP_OUT_OF_RANGE` / `INTERNAL`。

## CLI

```powershell
node dist\cli\cli.js new --n 7 --k 3 --start 1      # 新建并计算
node dist\cli\cli.js list                          # 列出算例
node dist\cli\cli.js result --id 1                 # 淘汰顺序与幸存者
node dist\cli\cli.js steps --id 1 --offset 0 --limit 3
node dist\cli\cli.js step --id 1 --r 3             # 第 3 次淘汰
node dist\cli\cli.js label --id 1 --label 5 --r 4  # 编号 5 前 4 步是否出局
node dist\cli\cli.js compare --n 7 --k 3 --starts 1,2,3
node dist\cli\cli.js verify --n 7 --k 3 --start 1 --order 3,6,2,7,5,1
node dist\cli\cli.js export --id 1 --format csv --out data\out.csv
node dist\cli\cli.js demo
```

## 实现要点

- `src/core/fenwick.ts`：Fenwick 树维护每个原位置是否存活，支持“第 k 个存活者”
  查询与存活后继（含绕回）查询，每步 O(log n)。
- `src/core/josephus.ts`：完整计算逐步记录（报数起点、当时人数、有效移动步数、
  淘汰者、下一起点、剩余数量），另含朴素基准与幸存者递推（仅供测试核对）。
- `src/db/store.ts`：SQLite 持久化，参数、引擎版本、淘汰次序与结果单事务写入。
- 历史查询基于已保存的淘汰顺序，不保存每步完整存活数组。

## 测试覆盖

- 演示用例 n=7/k=3/start=1；n=1；k=1；起点在尾部；k 恰为当前人数倍数。
- 超大 k（10^30 量级）与朴素逐人报数基准对照；小 n 全参数对照朴素实现。
- 幸存者递推核对（start=1）；每编号恰好出现一次；旋转起点得到旋转编号。
- 边界查询 r=0 与 r>=n-1；持久化后重开数据库读取任意步骤；候选顺序核验。
