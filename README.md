# 约瑟夫环报数淘汰后端

这是一个只包含 API 与 CLI 的 Windows 本地后端，用 TypeScript、Node.js 和内置 SQLite（`node:sqlite`）实现确定的约瑟夫环报数淘汰顺序。

服务不会进行随机抽奖、公平席位分配、淘汰后复活、动态步长或多人同时移除。编号始终使用 1 到 n；内部 Fenwick 树使用零基索引，但 API、CLI、日志和数据库结果都只输出一基编号。

## 算法与规模

- 用 Fenwick 树维护每个原位置是否存活。
- 当前有 m 人时，只在“存活者次序”上移动 `(k - 1) mod m` 步，不在原编号上直接相加取模。
- 每次通过 Fenwick 第 k 个存活者查询定位淘汰者，随后更新计数。
- 淘汰后从被淘汰者的下一位仍存活者继续；最后一人绕回为最终幸存者。
- `n` 限制为 `1...20000`。
- `k` 使用 BigInt 十进制字符串，最多 100 位，可以远大于 JavaScript 安全整数。
- 起点 `start` 必须是当前算例原环中的 `1...n` 编号；起点本人报一。
- `n=1` 时没有任何淘汰动作，编号 1（或该唯一编号）直接幸存。
- `k=1` 时每轮淘汰当前报数者。

## 环境要求

- Windows 本地 PowerShell。
- Node.js 25 或支持 `node:sqlite` 的 Node 版本。
- 不需要 Docker、WSL、付费服务或在线 API。

SQLite 数据默认写入项目内 `data/josephus.sqlite`。可用 `JOSEPHUS_DB=相对路径` 覆盖。

## 安装与构建

```powershell
npm install
npm run build
```

## 测试

```powershell
npm test
```

测试包含：

- 标准例题 `n=7,k=3,start=1`。
- `n=1`、`k=1`、起点在尾部、k 为当前人数倍数、跨边界查询。
- 超大 k 的 BigInt 取模跳步。
- 独立数组逐人报数基准。
- 默认起点幸存者递推核对。
- 每个编号恰好作为淘汰者或幸存者出现一次。
- 起点旋转后的编号旋转。
- SQLite 重启读取、分页和失败事务回滚。

## 启动 API

```powershell
npm start
```

默认监听 `127.0.0.1` 的一个空闲端口，启动日志会输出实际地址。也可以指定端口：

```powershell
$env:PORT="3000"
npm start
```

注意：当前 Node 版本可能打印 SQLite 实验特性警告，这不影响读写。

## HTTP API

### 健康检查

`GET /health`

### 新建并完整计算算例

`POST /cases`

```json
{ "n": 7, "k": "3", "start": 1 }
```

返回完整步骤、淘汰顺序和幸存者。计算先在内存完成，成功后才通过事务发布到 SQLite；失败不会留下不完整算例。

### 列出算例

`GET /cases`

### 读取算例完整结果

`GET /cases/{id}`

### 查询第 r 次淘汰

`GET /cases/{id}/steps?r=1`

- `r=0` 定义为尚未发生淘汰，返回边界说明。
- `r=n-1` 是最后一次淘汰。
- 不提供 `r` 时分页：`GET /cases/{id}/steps?limit=100&offset=0`。

逐步字段：

- `startLabel`：本报数轮的起点，一基编号。
- `aliveCount`：本轮开始时人数。
- `moves`：有效移动步数 `(k-1) mod aliveCount`。
- `eliminated`：本轮淘汰者。
- `nextStartLabel`：下一位仍存活者。
- `remaining`：淘汰后人数。

### 查询某编号在前 r 步是否已淘汰

`GET /cases/{id}/positions?label=3&through=2`

- `through=0`：尚未发生淘汰。
- `through=n-1`：所有淘汰完成后。
- `eliminationStep` 给出该编号最终在第几步出局；幸存者为 `null`。

### 核验候选淘汰顺序

`POST /cases/{id}/verify`

```json
{ "candidate": [3, 6, 2, 7, 5, 1] }
```

首次不匹配会返回失败步、当时人数、候选编号和应淘汰编号，而不只是检查编号是否不重复。

### 比较不同起点

`POST /cases/{id}/compare-start`

```json
{ "start": 4 }
```

返回两个起点的完整序列、幸存者和逐步旋转核对结果。

### 导出序列

`GET /cases/{id}/export`

## CLI

```powershell
# 标准演示和超大 k 演示
npm run demo

# 新建算例
node dist/cli.js create --n 7 --k 3 --start 1

# 列出算例
node dist/cli.js list

# 查看完整结果
node dist/cli.js get --id <CASE_ID>

# 分页查看步骤
node dist/cli.js steps --id <CASE_ID> --limit 2 --offset 2

# 查看第 r 次淘汰
node dist/cli.js step --id <CASE_ID> --r 1

# 查看某编号出局位置；--through 默认所有淘汰完成
node dist/cli.js position --id <CASE_ID> --label 3 --through 2

# 候选核验，逗号分隔或 JSON 数组均可
node dist/cli.js verify --id <CASE_ID> --candidate 3,6,2,7,5,1

# 比较起点
node dist/cli.js compare --id <CASE_ID> --start 4

# 导出完整算例
node dist/cli.js export --id <CASE_ID>
```

## 标准例题完整回放

输入：

```json
{ "n": 7, "k": "3", "start": 1 }
```

完整淘汰顺序：

```text
3, 6, 2, 7, 5, 1
```

最终幸存者：

```text
4
```

逐步回放：

| 步 | 起点 | 人数 | 有效移动 | 淘汰 | 下一起点 | 剩余 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 7 | 2 | 3 | 4 | 6 |
| 2 | 4 | 6 | 2 | 6 | 7 | 5 |
| 3 | 7 | 5 | 2 | 2 | 4 | 4 |
| 4 | 4 | 4 | 2 | 7 | 1 | 3 |
| 5 | 1 | 3 | 2 | 5 | 1 | 2 |
| 6 | 1 | 2 | 0 | 1 | 4 | 1 |

最后一步 `moves=0` 是因为 `(3-1) mod 2 = 0`，即起点本人报一，另一个存活者报二被淘汰。

超大 k 示例见：

```powershell
node dist/cli.js demo
```

该演示使用 55 位十进制 k；每轮只记录 `(k-1) mod m`，不会逐次数到 k。

## 错误码

- `INVALID_N`：n 不是 1 到 20000 的整数。
- `INVALID_K`：k 不是正整数十进制字符串，或超过 100 位。
- `INVALID_START`：起点不是原环中的有效编号。
- `INVALID_STEP`：步骤或 `through` 越界。
- `INVALID_POSITION`：查询编号越界。
- `INVALID_JSON`：请求体不是合法 JSON。
- `INVALID_QUERY`：分页等查询参数非法。
- `INVALID_CANDIDATE`：候选格式或长度非法。
- `NOT_FOUND`：算例、步骤或路由不存在。
- `PAYLOAD_TOO_LARGE`：请求体过大。
- `INTERNAL_ERROR`：未预期内部错误。

## SQLite 表

- `cases`：参数、执行版本、完整淘汰次序 JSON、幸存者和创建时间。
- `steps`：每个算例每一步的起点、人数、有效移动、淘汰者、下一起点和剩余数量。

重启后可再次列出、读取、分页查看任意步骤并查询编号出局位置。
