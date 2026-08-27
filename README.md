# 闽南博饼 Web 小游戏

一个基于 Three.js、cannon-es、React 和 PostgreSQL 的局域网多人中秋博饼游戏。服务端负责权威投掷、回合与奖项结算，浏览器负责 3D 动画和交互。

当前提供单个默认房间，并保留后续扩展多房间和密码房的边界。每局包含 63 份奖项，支持抢状元、回合倒计时、额外一轮和同阵容再开一局。

## 运行要求

- Node.js 22+
- pnpm
- PostgreSQL

项目不会通过 Docker Compose 启动或管理 PostgreSQL。数据库需要提前创建，连接信息通过环境变量传入。

## 启动

安装依赖，复制配置样例并按本机环境修改 `DATABASE_URL`：

```bash
pnpm install
cp .env.example .env
```

应用数据库迁移、构建并启动服务：

```bash
pnpm db:migrate
pnpm build
pnpm start
```

默认监听 `0.0.0.0:8787`。本机访问 `http://127.0.0.1:8787`，局域网设备使用服务端机器的 LAN IP 和相同端口访问。

`pnpm start`、`pnpm dev:server` 和 `pnpm db:migrate` 会读取仓库根目录的 `.env`。可选配置和默认值见 [.env.example](./.env.example)；显式设置的进程环境变量优先于 `.env`。

## 开发

只开发单机物理和 UI 时，可以关闭多人入口并启动 Vite：

```bash
VITE_MULTIPLAYER_ENABLED=false pnpm dev --host
```

开发多人服务端时，先构建 Web 产物，再启动源码服务：

```bash
pnpm build:web
pnpm dev:server
```

## 常用命令

| 命令              | 说明                                   |
| ----------------- | -------------------------------------- |
| `pnpm db:migrate` | 应用并校验 PostgreSQL 迁移             |
| `pnpm dev`        | 启动 Vite 开发服务器                   |
| `pnpm dev:server` | 启动服务端源码                         |
| `pnpm build`      | 构建 Web 和服务端生产产物              |
| `pnpm start`      | 启动生产服务                           |
| `pnpm test`       | 运行 Vitest 测试                       |
| `pnpm test:e2e`   | 运行桌面端和移动端 Playwright 流程测试 |
| `pnpm lint`       | 运行 ESLint                            |

## 项目结构

```text
apps/
├── web/                 # React、Three.js、浏览器物理动画与多人 UI
└── server/              # HTTP/WebSocket、房间编排与数据库迁移
packages/
├── game-domain/         # 判奖、奖池、抢状元和回合领域逻辑
├── protocol/            # WebSocket 协议与房间快照
└── physics-core/        # 服务端权威物理入口
```

## 文档

| 文档                                 | 内容                           |
| ------------------------------------ | ------------------------------ |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构、数据流、状态机与验收基线 |
| [CHECKLIST.md](./CHECKLIST.md)       | 当前完成度与后续任务           |
| [AGENTS.md](./AGENTS.md)             | 产品契约与开发工作流           |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI、移动端和素材规范           |
