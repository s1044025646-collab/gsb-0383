import { createApp, pickPort } from "./api/server";
import { CaseStore, defaultDbPath } from "./db/store";

async function main(): Promise<void> {
  const store = new CaseStore(defaultDbPath());
  const app = createApp(store);
  // 默认选择空闲端口；可用 PORT 环境变量指定固定端口
  const preferred = process.env.PORT ? Number(process.env.PORT) : 0;
  const port = await pickPort(preferred);
  const server = app.listen(port, () => {
    console.log(`约瑟夫环服务已启动: http://127.0.0.1:${port}`);
    console.log(`数据库文件: ${defaultDbPath()}`);
  });
  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
