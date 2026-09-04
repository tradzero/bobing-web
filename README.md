# 闽南博饼 Web 小游戏

一个基于 Three.js、cannon-es、React 和 PostgreSQL 的局域网多人中秋博饼游戏。服务端负责权威投掷、回合与奖项结算，浏览器负责 3D 动画和交互。

当前提供开放房、密码房和一个永久默认房；每个房间拥有独立成员、对局、回合和奖池。每局包含 63 份奖项，支持抢状元、回合倒计时、额外一轮和同阵容再开一局。

创建房间时会同时绑定创建者为房主。房主可二次确认后主动关闭非默认房；普通断线不会立即删除房间。默认房永久保留，其他房间按 `.env` 中可调的生命周期策略回收。

## 运行要求

- Node.js 24.11.1（见 `.nvmrc`；物理复现依赖固定 Node/V8）
- pnpm 10.14.0（见 `packageManager`）
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

- `/`、`/rooms`：查看或创建开放/密码房间；
- `/room/<id>`：可分享的指定房间入口。

`pnpm start`、`pnpm dev:multiplayer`、`pnpm dev:server` 和 `pnpm db:migrate` 会读取仓库根目录的 `.env`。可选配置和默认值见 [.env.example](./.env.example)；显式设置的进程环境变量优先于 `.env`。

## 开发

只开发单机物理和 UI 时，使用明确的单机 Vite 入口：

```bash
pnpm dev:singleplayer --host
```

开发多人功能时，构建 Web 产物并启动源码服务：

```bash
pnpm dev:multiplayer
```

项目使用 `pnpm`，不再提供含糊的 `dev` 脚本；它过去只启动 Vite、没有多人 HTTP/WebSocket 服务，会让页面一直停在连接状态。

## 常用命令

| 命令                             | 说明                                   |
| -------------------------------- | -------------------------------------- |
| `pnpm db:migrate`                | 应用并校验 PostgreSQL 迁移             |
| `pnpm room:reset`                | 强制清空指定房间（破坏性运维命令）     |
| `pnpm dev:singleplayer`          | 启动单机 Vite 开发服务器               |
| `pnpm dev:multiplayer`           | 构建 Web 并启动多人源码服务            |
| `pnpm dev:server`                | 启动服务端源码                         |
| `pnpm build`                     | 构建 Web 和服务端生产产物              |
| `pnpm start`                     | 启动生产服务                           |
| `pnpm typecheck`                 | 检查生产、测试与 e2e TypeScript        |
| `pnpm test`                      | 运行快速 Vitest 默认门禁               |
| `pnpm test:slow`                 | 运行独立的慢速物理等价验收             |
| `pnpm test:e2e`                  | 运行桌面端和移动端 Playwright 流程测试 |
| `pnpm test:e2e:multiplayer`      | 运行多房间、断线与服务重启恢复流程     |
| `pnpm test:e2e:multiplayer:soak` | 运行三浏览器 deadline 与多局循环慢门禁 |
| `pnpm test:db`                   | 运行 PostgreSQL repository 集成测试    |
| `pnpm lint`                      | 运行 ESLint                            |

数据库测试不会自动读取普通 `DATABASE_URL`，需要显式提供：

```bash
TEST_DATABASE_URL=postgresql://... pnpm test:db
TEST_DATABASE_URL=postgresql://... pnpm test:e2e:multiplayer
```

这些门禁都使用随机测试房间并精确清理。整局 E2E 会在一次真实投掷后用数据库夹具把该随机房间推进到奖池耗尽，后续结算、结束、加投和再开一局均走真实产品链路。本地开发库只能在确认数据可丢弃后显式作为 `TEST_DATABASE_URL`，生产库不得这样使用。

多人 soak 默认运行 3 局、每局 3 次常规真实投掷，并验证普通回合连续超时、结束选择超时和加投全员超时；可用 `MULTIPLAYER_SOAK_GAMES`（2–10）与 `MULTIPLAYER_SOAK_ROLLS_PER_GAME`（1–20）扩大本地 LAN 长跑规模。

强制重置房间时先停止应用服务，再显式确认目标房间 ID：

```bash
pnpm room:reset -- --room=default --confirm=default
```

该命令保留房间配置，但永久删除其成员、对局、投掷和奖项数据。完成后重新启动服务，所有玩家刷新页面；同一访问地址下，浏览器会保留昵称并自动重新绑定为新成员。

玩家身份以当前浏览器同源站点存储中的高熵恢复令牌绑定，服务端只保存令牌哈希。密码只用于首次加入，不保存在浏览器会话中；恢复令牌验证通过后可直接恢复同一房间身份。切换 origin、浏览器或无痕窗口会形成新身份。

## 项目结构

```text
apps/
├── web/                 # React、Three.js、浏览器物理动画与多人 UI
└── server/              # HTTP/WebSocket、房间编排与数据库迁移
packages/
├── game-domain/         # 判奖、奖池、抢状元和回合领域逻辑
├── protocol/            # WebSocket、房间目录与快照契约
└── physics-core/        # 共享 Cannon 物理、调度、诊断和服务端权威入口
```

## 文档

| 文档                                 | 内容                           |
| ------------------------------------ | ------------------------------ |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构、数据流、状态机与验收基线 |
| [CHECKLIST.md](./CHECKLIST.md)       | 当前完成度与后续任务           |
| [AGENTS.md](./AGENTS.md)             | 产品契约与开发工作流           |
| [UI-CHECKLIST.md](./UI-CHECKLIST.md) | UI、移动端和素材规范           |
