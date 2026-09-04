# 博饼小游戏技术架构

本文只描述当前架构和仍有效的契约。历史实验结论由 Git 与生成的 `artifacts/`/`logs/` 保存，不继续堆叠在架构正文中。

## 技术栈

| 层面   | 选型                                            |
| ------ | ----------------------------------------------- |
| 工程   | Node.js 24.11.1、pnpm 10.14.0、Vite、TypeScript |
| Web    | React 19、Zustand 5、Three.js、cannon-es        |
| Server | Node.js、ws、pg                                 |
| 持久化 | PostgreSQL + 版本化 SQL migration               |
| 验证   | Vitest、Playwright、独立 physics/sweep runners  |

Node/V8 会影响 IEEE-754 末位和 canonical hash，因此 `.nvmrc`、`engines` 与 `packageManager` 属于物理复现契约，不只是开发体验配置。

## 仓库边界

```text
apps/
├── web/                    React UI、Three 渲染、单机产品、多人客户端
└── server/                 HTTP/WebSocket、deadline/生命周期、PostgreSQL repository
packages/
├── game-domain/            判奖、63 份奖池、回合、抢状元纯领域逻辑
├── protocol/               WebSocket、房间目录和 RoomSnapshot 契约
└── physics-core/           共享 Cannon 配置、刚体、读面、调度、诊断和 headless 编排
scripts/                    物理验收、A/B、迁移与运维入口
sweep/                      保留的参数扫描/诊断脚本
e2e/                        单机浏览器流程、soak 与隔离性能实验
```

浏览器规则层直接依赖 `@dice/game-domain`，不存在第二套 Web façade。`packages/physics-core` 持有共享物理配置、PRNG、Cannon 刚体/世界、读面、投掷、停稳、逐步诊断、调度累加器和 headless 编排。`apps/web/src/dice` 仅保留 Three 骰子网格与初始展示摆放，`apps/web/src/physics` 仅保留 Three transform 映射；server tsconfig 不再声明 DOM lib，也不再解析 `@/` Web 路径。

## 单机与多人产品入口

`App.tsx` 保留单机与多人入口；多人入口再按 URL 选择房间：

- `VITE_MULTIPLAYER_ENABLED=false`：单机 `GameViewport + GameOverlay`；
- `/`：兼容入口，加入 `VITE_DEFAULT_ROOM_ID`；
- `/rooms`：开放房大厅，通过同源 `GET/POST /api/rooms` 列出或创建房间；
- `/room/<id>`：连接同源 `/ws` 并加入指定房间，可直接分享 URL。

普通测试/e2e 构建强制走单机入口，避免数据库成为物理/UI 浏览器门禁的隐式依赖。`test:e2e:multiplayer` 独立构建多人入口，启动真实 HTTP/WebSocket 服务，并使用四个隔离 BrowserContext 从公开大厅创建两个房间，验证房间发现、并行对局、广播隔离和身份恢复。

## 多人权威链路

```text
浏览器命令
   │
   ▼
RoomHub ── session/command 校验 ── WebSocket 广播 RoomSnapshot
   │
   ├── RoomRollService ── physics-core.runRoll(seed)
   │                         └── 错误只记诊断，不产生可提交结果
   ▼
RoomRepository ── PostgreSQL 事务
   │                 ├── games / turns / roll_attempts
   │                 ├── game_prize_pools / award_grants
   │                 ├── zhuangyuan_claims / game_events
   │                 └── room_members / sessions
   ▼
game-domain ── 回合推进、库存扣减、抢状元、结束/加投语义
```

服务端先在数据库事务外完成 CPU 物理，再以短事务锁定当前 room/game/turn。投掷使用 UUID command ID 幂等；同一事务提交 attempt、奖项、状元归属和下一回合，避免错误重试造成双扣奖或双推进。

客户端收到 seed 后播放同一初始条件，但客户端读面和判奖仅供画面核对，不具备权威写入权。服务端发生 timeout、NaN、越界、guard 介入、floor tracker 不可用/命中或预算耗尽时，只记录错误并按配置重试/结束当前操作。

### 房间与身份

- 进程启动时确保 `DEFAULT_ROOM_ID` 对应的永久开放房存在；此外可由 `POST /api/rooms` 创建服务端 UUID 标识的开放房，`GET /api/rooms` 只列出未归档房间的名称、阶段和成员计数。
- 当前没有账户或管理员鉴权，因此能访问服务的局域网用户都能创建开放房。创建请求必须同时提交房间名和创建者昵称；room、房主成员、恢复令牌和 lobby 在同一事务生成，创建者不会被并发加入者抢走房主。接口限制 JSON 类型、4 KiB 请求体、32 字符房间名和 24 字符昵称，但暂未设置用户配额或速率限制。
- `POST /api/rooms` 只把新房主的原始恢复令牌返回一次；GET 目录不返回奖项、投掷或身份信息。实际恢复/加入仍走带 `roomId` 的 WebSocket protocol v1。password hash 和访问类型继续保留扩展位，但当前 API 不创建或加入密码房。
- 开局按加入顺序锁定座位，开局后以及结束/废弃后才加入的成员为旁观者。
- 浏览器按 `roomId` 在同源 `localStorage` 分别保存昵称和 256-bit 恢复令牌，受限时回退到同标签页 `sessionStorage`；PostgreSQL 只保存令牌 SHA-256。普通刷新、断线和服务重启会自动恢复，不同房间不会覆盖彼此身份。
- 强制清房后旧令牌失效；客户端只在首次恢复收到 `not-found` 时保留昵称、丢弃旧令牌并无令牌重绑一次。
- 切换 host/IP/port、浏览器或无痕窗口会形成不同 origin/身份，这是当前局域网 MVP 的明确边界。
- WebSocket 关闭只改变内存中的 `connected` 展示，不会立即退房、释放昵称或删除对局；加入/恢复和 20 秒在线心跳把 presence 持久化，但心跳不算游戏操作。
- 生命周期以 PostgreSQL 时间列为真值：未加入过的非默认空房 1 小时后删除；进行中的游戏 30 分钟没有真实命令后转为 `abandoned`，当前 turn 以 `room-abandoned` 跳过且不再创建下一 turn；lobby/finished/abandoned 非默认房在真实活动和最后在线心跳都超过 24 小时后归档并从大厅隐藏；归档 7 天后硬删除。上述时长和 60 秒轮询均可由环境变量调整。
- `DEFAULT_ROOM_ID` 不参与归档和删除，但其中的闲置进行中游戏仍会废弃，避免默认房产生无限 timeout 写入。废弃局保留奖项和投掷历史，原房主可按锁定阵容再开一局。

### Deadline、生命周期与重置

PostgreSQL 中的绝对时间是 deadline 真值，scheduler 的 interval 只负责唤醒：

- `awaiting-roll` 到期：跳过当前玩家；
- `rolling` 到揭晓时间：提交已计算权威结果，不走跳过分支；
- `tilt-decision` 到期：在预算内生成同回合自动重投，耗尽后跳过；
- `end-decision` 到期：默认立即结束。

所有时限来自环境变量，重启后可继续。强制重置只提供停服 CLI：

独立 lifecycle scheduler 同样只负责唤醒：断线人数不是删除依据；房间真实操作使用 `last_activity_at`，在线事实直接复用成员 `last_seen_at`，归档和废弃分别由 `archived_at` 与 `games.abandoned_at` 表达。活动命令与归档采用 room 行锁串行化，避免开局/投掷与归档交叉产生“已归档但仍在进行”的状态。

```bash
pnpm room:reset -- --room=<id> --confirm=<id>
```

repository 在事务内锁定目标房间，删除该房间成员和对局衍生数据但保留房间配置。该操作不可由未认证 HTTP/WebSocket 触发。

## 多人规则

每局实体库存固定为：状元 1、对堂 2、三红 4、四进 8、二举 16、一秀 32，共 63 份。普通奖库存耗尽后仍保留投掷历史，但 allocation reason 明确为未分配，不允许负库存。

状元使用每位玩家最后一次 claim，而不是普通 grant：同一玩家的新状元无条件替换旧 claim；系统再按状元子级、带数、六骰点数和守擂顺序选出唯一持有者。

库存清空后进入房主选择：立即结束，或让本局锁定玩家各加投一次。加投不分配普通奖但仍能抢状元。结束后仅原房主能按原阵容和座位再开一局；结束后加入的旁观者不会进入新局。

## 物理与渲染边界

React 只负责 DOM overlay。`GameViewport` 创建/销毁 scene、physics、`DiceSet`、store、controller 和 engine；`GameController` 是单机业务状态的唯一编排入口；Zustand action 只做状态写入。

`game/engine.ts` 拥有唯一 rAF：

- `idle / settled / error`：按需绘制单帧，不推进物理；
- `rolling`：连续 rAF，以显式 accumulator 接纳墙钟并逐个执行 Cannon 固定步；
- `stopped`：不再调度。

页面隐藏时间记入 paused/discarded，不偷偷形成恢复后的巨大 backlog。持续过载进入独立 `timing-overload` 错误；timeout 同样冻结 raw 画面并禁止正常结算。

### 正式运行时与实验层

正式构建通过 Vite 精确 alias 只装入当前实现：

| 维度    | 正式实现                                   | 实验入口                                      |
| ------- | ------------------------------------------ | --------------------------------------------- |
| 投掷    | `dice/throw-runtime.ts`：`stratified-ring` | `dice/throw.ts`：legacy/radial/uniform 适配   |
| 停稳    | `dice/settle-runtime.ts`：无 assist        | `dice/settle.ts`：显式 contact-cluster assist |
| 世界    | `physics/world-runtime.ts`：cannon-default | `physics/world.ts`：projected-AABB 候选       |
| 调度    | exact-cap6 runtime preset                  | legacy-batched / exact-cap4 e2e preset        |
| profile | 生产禁用                                   | e2e rolling CPU profile v2                    |
| 渲染    | reduced tier rolling DPR 1x，阴影逐帧      | e2e DPR/阴影候选                              |

Vitest、显式 `vite-node --mode lab` 脚本和 `vite build --mode e2e` 使用实验适配层，因此历史证据仍可复现；普通 Web/Server build 不携带这些候选实现。当前算法的实际函数只存在一份，实验适配层调用正式函数，不复制近似实现。

### 投掷、停稳与读面

- THROW v3 使用 seed 派生独立 layout/dynamics 子流；六骰在随机旋转的六扇区环上构造，并随机打乱骰子到槽位映射。
- SETTLE v4 依次识别 timeout、Cannon natural sleep、只读姿态稳定窗口和连续低速窗口。正式路径不执行 contact-cluster 冻结。
- 读面将每个本地面法线经最终四元数变换到世界坐标，与 world-up 点积取最大值，同时输出置信度/倾斜信息。
- 读面前捕获 canonical raw body state；产品层随后才冻结画面，避免冻结动作污染真值。

### 碗、骰子与安全诊断

- 碗底是由共享曲线生成的 51×51 Heightfield；16 个薄 Box 组成内侧挡墙；桌面平面是极端情况兜底。
- 骰子物理采用 `CANNON.Box`，视觉采用 RoundedBox geometry + 单材质 atlas 的 6-instance `InstancedMesh`。视觉圆角不改变物理形状。
- 每个 exact step 按固定顺序执行世界推进、未介入安全采样、floor-relaunch tracker、escape guard、settle 检测。
- floor-relaunch 只有在已观察真实碗底接触并建立持续支撑后，二次离地持续时间、clearance 和有序上升同时过阈值才锁存。tracker 前提不满足时明确返回 unavailable。
- 诊断记录 seed、算法版本、initial/final Float64 canonical state 和 hash、settlement、速度/角速度、边界/穿透、guard、姿态与 floor tracker 数据。

## 单机状态机

```text
idle/result ── throw ──▶ rolling
rolling ── trusted settle ──▶ result
rolling ── ambiguous pose ──▶ tilt-confirm ── accept ▶ result
                                      └────── retry  ▶ rolling
rolling ── timeout/overload/safety error ──▶ error
error ── retry same round ──▶ rolling
error/result ── reset ──▶ idle (round 1)
```

只有可信结算写入 `diceValues/currentResult/history/prizeRecord`。重复或迟到回调在非 rolling 阶段无副作用。

## 奖级优先级表（确认版）

| 优先级 | 奖级       | 条件                            |
| ------ | ---------- | ------------------------------- |
| 1      | 状元插金花 | 4 个四 + 2 个一                 |
| 2      | 满堂红     | 6 个四                          |
| 3      | 遍地锦     | 6 个一                          |
| 4      | 六子       | 6 个相同，排除一/四；点数大者高 |
| 5      | 五红       | 5 个四                          |
| 6      | 五子登科   | 5 个相同，排除四                |
| 7      | 状元       | 4 个四且非插金花                |
| 8      | 对堂       | 1–6 各一个                      |
| 9      | 三红       | 3 个四                          |
| 10     | 四进       | 4 个相同，排除四                |
| 11     | 二举       | 2 个四                          |
| 12     | 一秀       | 1 个四                          |
| 13     | 未中奖     | 无匹配                          |

除完全占用 6 颗骰子的规则外，剩余骰子之和为带数；判奖函数返回命中骰、剩余骰和带数，便于人工核对。

## 视觉资源

海碗当前只使用 `bowl-blue-white-seamless-v2.webp`。纹样通过半幅重排/镜像拼接隐藏 UV 接缝；解码和首次材质上传完成前显示不透明加载页。加载失败或 8 秒超时后替换为程序化 CanvasTexture，两条路径同时只保留一个活动 wall texture。

桌面继续使用程序化木纹。移动端为真实上下文档流：当前结果/确认优先，主操作其次，历史和累计数据最后；不维护可拖拽浮层状态。

## 验证分层

- `pnpm test`：快速默认 Vitest；不包含 `__tests__/slow/`。
- `pnpm test:slow` / `pnpm test:collision:acceptance`：200-seed projected-AABB 完整结果与 canonical 严格等价。
- `pnpm test:physics`、`test:seed`、`test:acceptance`、`test:physics:ab`、`test:physics:cadence`：从 watch seed 到长样本/A-B 的物理门禁。
- `pnpm test:e2e` / `test:e2e:soak`：桌面、移动、错误恢复、静态调度和连续投掷。
- `pnpm test:e2e:multiplayer`：从大厅创建两个随机房间，使用真实服务、数据库和六个浏览器上下文验证分别加入/开局/投掷、广播隔离、定向 WebSocket 中断重连、重复命令幂等、真实进程重启、deadline 推进和身份恢复。
- `bench:browser:*`：隔离 e2e 构建中的结构预算与配对性能实验。
- PostgreSQL repository 与多人 E2E 只使用显式 `TEST_DATABASE_URL`；测试房间随机生成并精确清理。开发者明确授权时可指向可丢弃的本地开发库，不能指向生产库。

稳定 sweep 仅保留 param、sleep、timeout、jitter、tilt、bench、contact equation/grid/validate 和 solver A/B，可用 `pnpm sweep:parallel -- --list` 查询。一次性历史诊断脚本已删除；Git 仍保存其历史。
