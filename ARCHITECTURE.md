# 博饼小游戏 - 技术架构

## 技术栈

| 层面     | 选型                               | 版本策略      |
| -------- | ---------------------------------- | ------------- |
| 工程基座 | Vite + TypeScript                  | latest stable |
| 包管理   | pnpm                               | latest stable |
| UI 层    | React                              | 19.x          |
| 状态管理 | Zustand                            | 5.x           |
| 3D 渲染  | Three.js（原生命令式，不使用 R3F） | latest stable |
| 物理引擎 | cannon-es（原生命令式）            | latest stable |
| 测试     | Vitest                             | latest stable |
| CSS      | 原生 CSS 文件 + CSS Variables      | —             |

## 架构原则

1. **React 不侵入 3D 层**：Three.js 和 cannon-es 保持命令式调用，React 只负责 DOM UI overlay。Canvas 容器由 GameViewport 组件提供 ref，引擎实例的创建和销毁在该组件的 useEffect 中完成。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，overlay 组件作为 children 渲染在 Provider 内部，确保能通过 useGameController() 获取 controller 实例。
2. **Zustand 单向写入**：Store 的 actions 为纯状态设置器（只做 setState，无业务逻辑）。所有业务流程入口收归 GameController 一处，controller 内部调用 store 设置状态。UI 组件只通过 selector 读取 store，写入权限归 controller。
3. **按需单一时钟源**：`game/engine.ts` 拥有唯一 rAF 调度器，并显式维护 `idle / rolling / settled / stopped`。只有 `rolling` 连续申请下一帧；`idle / settled` 仅在启动或失效请求时渲染单帧，`stopped` 不再调度。其他模块（`world.ts`、`settle.ts`）不自持循环或轮询。
4. **配置集中管理**：所有可调参数（物理、投掷、停稳、渲染质量、UI 常量）集中在 `config/` 下，不散落在业务模块中。
5. **规则数据驱动**：奖级判定规则以可枚举的数据结构定义，按 priority 升序排列（数值越小优先级越高，排在前面），判定函数为纯函数，返回完整结果对象（奖级 + 带数 + 命中详情）。
6. **响应式归 CSS**：布局、按钮尺寸、面板排列等响应式适配交给 CSS 媒体查询。脚本层只处理 canvas resize、受预算约束的 DPR、camera aspect ratio、阴影档位，并在有效 resize 后发出一次渲染失效请求。
7. **核心逻辑可测试**：奖级判定、点数读取、停稳检测为纯函数/可隔离逻辑，Vitest 重点覆盖。随机数源抽为可注入接口，测试时注入确定性种子。
8. **StrictMode 幂等且资源所有权明确**：引擎初始化和销毁必须幂等。React StrictMode 会在开发环境双调用 effect；每个 `DiceSet` 独占 instance buffer、geometry、material 和 texture，不跨挂载缓存，GameViewport cleanup 必须先将其移出 scene，再显式 `dispose()`，重建时不复用上一实例已释放的资源。
9. **移动端布局不引入额外 UI 状态**：移动端采用真实上下布局，结算卡仅通过 CSS 在上下分界线处做轻度侵入，不再维护 `peek / expanded / hidden` 之类的局部状态。store 只提供 `phase` 驱动 `ResultPanel / TiltWarning` 的显隐，不影响 game/controller 的业务状态机。
10. **视觉占位先于正式素材**：当前允许用程序化木纹、程序化青花纹样等占位资源推进画面；后续替换正式素材时应通过贴图/样式替换完成，不反向改动业务流、物理结构和 UI 状态机。

## 项目结构

```text
src/
├── main.tsx                    # 入口：仅 createRoot().render(<App />)
├── App.tsx                     # React 根组件：GameViewport + GameOverlay（顶栏、结算区、内容 peek、侧栏）
│
├── config/
│   ├── physics.ts              # 物理参数：质量、阻尼、摩擦、弹性、步长、子步进
│   ├── throw.ts                # 投掷参数：默认 stratified-ring、速度/角速度/高度
│   ├── settle.ts               # 停稳参数：低速/只读姿态窗口、assist 默认开关、timeout/倾斜阈值
│   ├── physics-variants.ts     # 命名 A/B preset：投掷、assist 与 pose detector 的可复现组合
│   ├── render.ts               # 渲染质量：DPR / drawing-buffer 像素预算 / 阴影档位
│   └── ui.ts                   # UI 常量：HISTORY_MAX_LENGTH、INITIAL_ROUND；触摸目标尺寸单一来源 CSS --touch-min
│
├── game/
│   ├── engine.ts               # 运行时：按需 rAF 状态机、物理步进、插值/最终姿态渲染、停稳检测、dispose
│   ├── controller.ts           # 游戏编排层：状态机、轮次推进、结算触发、重置（唯一业务入口）
│   └── store.ts                # Zustand store：游戏状态 + 纯状态设置器
│
├── scene/
│   ├── setup.ts                # Three.js 场景、renderer、灯光、摄像机预设、resize 质量与失效通知（无 PMREM、无 rAF 循环）
│   ├── table.ts                # 圆桌占位模型 + 程序化木纹/圈层；后续可叠桌布
│   ├── bowl.ts                 # 海碗可视模型 + 程序化青花纹样占位
│   └── decorations.ts          # 旧桌面装饰实验文件，当前未接入 GameViewport 运行时
│
├── physics/
│   ├── world.ts                # cannon-es 世界初始化、暴露 world 实例和 step 函数（不自持循环）
│   ├── bowl-body.ts            # 碗碰撞体（Heightfield 连续碗底 + 竖直挡墙）
│   ├── body-transform.ts       # Cannon raw/interpolated pose → Three 对象；teleport 插值状态同步
│   ├── escape-guard.ts         # 运行时逃逸保护与可观测介入计数
│   ├── roll-runner.ts          # 无渲染统一投掷 runner，复用运行时行为链
│   ├── roll-comparison.ts      # 命名 variant A/B、watch/batch cohort 与 natural continuation
│   ├── roll-diagnostics.ts     # 逐帧物理极值与安全诊断
│   └── materials.ts            # 物理材质定义与接触材质配对
│
├── dice/
│   ├── create.ts               # DiceSet：单材质 atlas InstancedMesh + 6 个姿态代理/body + 显式资源释放
│   ├── dice-body.ts            # 骰子物理 body：box / chamfer 形状切换与 FACE_NORMALS
│   ├── throw.ts                # 投掷 v3：六槽分层环、layout/dynamics 子流、命名历史采样器
│   ├── rest.ts                 # 首屏/重置静态姿态：贴合碗底、同步插值历史并休眠
│   ├── settle.ts               # 停稳检测：返回结构化 SettleResult | null（不自持轮询）
│   ├── contact-cluster-assist.ts # 历史尾段接触簇冻结辅助；运行时默认关闭，仅 A/B 显式开启
│   └── read-face.ts            # 朝上面读取：六面法线与世界 up 向量点积
│
├── rules/
│   ├── types.ts                # 奖级枚举、JudgeResult 结果对象、规则数据结构类型
│   ├── prizes.ts               # 全部奖级规则表（按 priority 升序排列，数值小 = 优先级高）
│   └── judge.ts                # 判定函数：输入 6 个点数 → 输出 JudgeResult 完整结果对象
│
├── ui/
│   ├── components/
│   │   ├── GameViewport.tsx    # 3D 容器：装配/销毁 DiceSet 与引擎，绑定 resize 失效，开发态发布 diagnostics
│   │   ├── ThrowButton.tsx     # 掷骰按钮（rolling/tilt-confirm 禁用 + 状态文案）
│   │   ├── ResetButton.tsx     # 重置按钮
│   │   ├── TiltWarning.tsx     # 倾斜确认面板：显示倾斜骰子编号，提供「接受结果」「重掷」按钮
│   │   ├── ResultPanel.tsx     # 当轮结果面板：点数组合 + 奖级 + 带数（tilt-confirm 期间隐藏）
│   │   ├── PrizeRecord.tsx     # 本局累计奖级记录（奖池/榜单面板）
│   │   ├── History.tsx         # 最近 5 轮历史记录
│   │   └── SoundToggle.tsx     # 音效开关
│   └── styles/                 # 原生 CSS 文件：global.css / variables.css / game.css
│
├── audio/
│   └── sound.ts                # 音效管理：碰撞声、中奖提示音、节流控制
│
├── utils/
│   └── random.ts               # 时间种子 mulberry32、固定 seed 复现、稳定派生随机子流
│
└── __tests__/                  # 快速测试（pnpm test，全量 <30s）
    ├── judge.test.ts           # 奖级判定：全部奖级示例 + 46656 种穷举校验
    ├── read-face.test.ts       # 点数读取：24 个合法朝向 + 近边界扰动样本
    ├── chamfer.test.ts         # 倒角骰子几何验证：顶点/面数、对称性、尺寸
    ├── settle.test.ts          # 停稳检测：假时钟 + 快照序列、多种边界场景
    ├── settle-regression.test.ts # 停稳回归：已知问题种子的结算路径验证
    ├── controller.test.ts      # 编排层集成：phase 变化、重复点击、history 上限、reset、sound
    ├── engine-timing.test.ts   # 引擎时序：按需/连续 rAF、插值帧与最终 raw 帧验证
    ├── body-transform.test.ts  # raw/interpolated pose 复制与 teleport 状态同步
    ├── dice-instancing.test.ts # atlas 实例、代理矩阵同步、资源所有权与 dispose 幂等
    ├── rest.test.ts            # idle 静态姿态、运动状态清理与插值历史同步
    ├── render-config.test.ts   # DPR、drawing-buffer 像素预算与阴影档位
    ├── scene-setup.test.ts     # resize 去重、质量切档、渲染失效通知与不创建 PMREM
    ├── css-performance-contract.test.ts # 桌面视觉保留与移动/slow 合成降级、reduced-motion 动效契约
    ├── strict-mode.test.tsx    # 重挂载资源配对、无残留 canvas/rAF 与开发 diagnostics 口径
    ├── tilt-flow.test.ts       # 倾斜确认流程：tilt-confirm 进入/pending 隔离/接受/重掷/throw 拒绝/reset/冻结/35° 不触发
    ├── physics-smoke.test.ts   # 物理烟雾：真实世界 + 碗 + 骰子，固定种子跑 N 帧，无 NaN/不穿模
    ├── bowl-body.test.ts       # 碗碰撞体：Heightfield 几何、挡墙布局
    ├── dice-escape.test.ts     # 骰子逃逸防护：多种子验证反弹后不飞出
    ├── throw-geometry.test.ts  # 投掷几何：初始位置/速度分布验证
    ├── throw-invariants.test.ts # 投掷不变量：确定性种子结果一致性
    ├── fallback-rate.test.ts   # fallback 触发率统计
    ├── freeze-consistency.test.ts # 历史 Assist 截断 vs 默认自然终态反事实
    ├── contact-cluster-assist.test.ts # 历史接触簇能力与默认禁用契约
    ├── reproduce-seed.test.ts  # 关键种子复现：已知问题种子的详细诊断
    └── review-verify.test.ts   # 审查验证：高度分层、fallback 拓扑覆盖、关键种子复现

scripts/
├── physics-acceptance.ts       # 单 seed / 批量验收，结构化输出版本、配置与物理极值
└── physics-ab.ts               # 命名 preset 的 A/B、B/A 交替执行和结果门禁

sweep/                          # 独立长时间运行脚本（按需手动执行，不在 pnpm test 中）
├── lib/
│   ├── log.ts                  # NDJSON 增量日志器：appendFileSync 防崩溃丢失
│   └── run-trial.ts            # 共享试验运行器：物理世界→投掷→步进→停稳→读数
├── param-sweep.ts              # 摩擦/恢复系数参数扫描（pnpm sweep:param）
├── sleep-sweep.ts              # sleepTimeLimit 参数扫描（pnpm sweep:sleep）
├── timeout-risk.ts             # 超时风险统计（pnpm sweep:timeout）
├── jitter-diagnose.ts          # 抖动种子诊断（pnpm sweep:jitter）
└── tilt-stats.ts               # 倾斜统计（pnpm sweep:tilt）
```

## 当前视觉占位策略

- 运行时场景当前只接入桌面、海碗和 6 颗骰子；`scene/decorations.ts` 保留为旧实验文件，不在 `GameViewport` 中挂载。
- 海碗外壁当前使用 `CanvasTexture` 生成程序化青花纹样占位，正式纹样素材的尺寸、比例、无缝与格式规范记录在 `UI-CHECKLIST.md`。
- 桌面当前使用程序化木纹与环形嵌饰作为占位视觉；后续美术方向优先在现有桌体上叠加桌布，而不是继续扩展桌腿、桌裙板或独立摆件。
- 场景使用纯色背景、方向光、环境光和半球光，不生成 PMREM。旧路径在 `createScene()` 阶段生成环境贴图时，桌面、海碗和骰子尚未加入 scene，得到的环境信息有限；同时只保留 target texture 会丢失 render target 的所有权，无法由场景上下文可靠释放，因此已删除该路径并保持 `scene.environment = null`。
- 这类视觉占位的目标是先稳定构图与层次，不改变物理世界、碰撞体和游戏状态流。

## 骰子渲染与资源生命周期

- 运行时通过 `createDiceSet()` 创建一个单材质 `InstancedMesh`，共享一份 `RoundedBoxGeometry`、一份 `MeshPhysicalMaterial` 与一张 3×2 骰面 atlas；6 颗骰子仍各自拥有独立 Cannon body。
- 每个 `DicePair.mesh` 在 DiceSet 路径中是一个不加入 scene 的轻量 `Object3D` 姿态代理。Engine 将 raw 或 interpolated body pose 写入代理，再调用 `syncVisual()` 通过 `setMatrixAt()` 更新对应的 instance matrix。`createDice()` 继续保留返回单颗独立 `Mesh + body` 的兼容接口。
- 创建资源时先按 RoundedBoxGeometry 原始 6 个连续面区间和 `FACE_MAP` 重映射 UV，再将 draw group 合并为一个单材质提交；测试直接锁定每个面区间的平均法线、点数与 atlas 格子三者一致。因此渲染结构是“一个实例对象、一个材质提交”，而不是为每颗或每面分别持有完整 Mesh/geometry/material。
- DiceSet 资源随 GameViewport 挂载生命周期存在，不在每次投掷时重建，也不跨 DiceSet/StrictMode 重挂载缓存。卸载时先从 scene 移除实例对象，再调用幂等的 `DiceSet.dispose()` 释放 instance buffer、geometry、material 和 texture，随后才执行场景通用资源遍历，避免重复释放。

## 投掷、停稳与可复现性

- 运行时投掷默认为 `stratified-ring`：6 个等角度槽位使用同一环形半径，每轮随机旋转整体布局，再随机打乱“骰子索引 → 槽位”分配。该路径是永远满足初始间距的构造式布局，不走 rejection/fallback。
- 投掷 v3 将随机计划版本化，用同一 seed 派生独立的 layout 和 dynamics 子流。因此更换位置 sampler 不会改变高度、四元数、线速度和角速度的单骰随机单位值。普通运行使用时间种子初始化 mulberry32，e2e/诊断可注入一次性 seed；生产路径不使用 `Math.random`。
- `legacy-v1` 保留旧共享随机流，`uniform-area-restarts` 保留面积均匀 rejection 与整组重试；二者不是运行时默认，只通过命名 A/B preset 作历史/布局对照。
- 停稳 v4 区分 `natural-sleep / stable-window / pose-stable-window / cluster-assist / timeout`。contact-cluster assist 运行时默认关闭，只有 historical variant 显式开启以复现旧冻结路径。
- `pose-stable-window` 在投掷 1.2s 后才可建立锚点，要求完整 0.75s 内每颗骰子相对锚点位移不超过 2mm、四元数角距不超过 0.015rad，且逐骰读面不变。它只读 body 姿态，不清速度、不 sleep、不改四元数，也不用瞬时线速度/角速度噪声预筛空间稳定。
- `timeout` 目前已作为独立结算原因上报，但产品层的异常/重试/救援 UI 尚未完成；不应把这项描述为正常奖级流程已验收。

### 统一 runner、命名 variant 与反事实

- `physics/roll-runner.ts` 的 `runRoll()` 无渲染执行完整投掷，复用正式的 `throwDice`、world/step、escape guard、`checkSettled` 和读面实现。诊断记录投掷/停稳算法版本、投掷路径、结算原因、介入、速度、漂移、接触穿透与最终读面。
- variant schema v2 固定五组行为：`historical = legacy + assist on + pose off`、`placement-control = uniform + off + off`、`placement-candidate = stratified + off + off`、`natural-control = legacy + off + off`、`current = stratified + off + pose on`。
- `test:physics:ab` 按 seed 交替执行 A/B、B/A。固定历史问题 seed 归入 watch cohort；其他 seed 归入 batch cohort，仅 batch 承担分布和回退预算，避免 watch 过采样污染一般性结论。
- 两侧每个非 `natural-sleep` 结果都以相同 seed 和投掷算法另起一次关闭 assist/pose detector 的 `natural-continuation`，最多继续 20s。candidate 必须与对照的逐骰面值、倾斜分类和完整 `JudgeResult` 一致，且 continuation 不得出现 NaN、越墙或 escape-guard 介入。

## 核心数据流

```text
用户点击掷骰按钮
    │
    ▼
React UI ──调用──▶ GameController.throw()（唯一业务入口）
    │
    ▼
GameController:
    1. 拒绝非 idle/result 阶段的调用（防重复点击）
    2. store.setPhase('rolling')  ← UI 按钮禁用
    3. dice/throw.ts → 设置骰子初始位置、旋转、速度、角速度，并同步 teleport 后的 Cannon 插值状态
    4. engine.beginSettle() → 引擎进入 rolling，开始连续 rAF
    │
    ▼
Engine rolling 循环（game/engine.ts，唯一连续 rAF）：
    首帧只建立 timestamp 基准并显示投掷后的插值 pose；后续每帧：
    ① physics/world.ts → world.step(fixedTimeStep, dt, maxSubSteps)
    ② 应用逃逸保护
    ③ dice/settle.ts → checkSettled()（返回 SettleResult | null）
    ④ 未停稳：Cannon interpolated pose → Object3D proxy → instanceMatrix → renderer.render() → 申请下一帧
    │
    ▼
settle 返回结构化结果（natural-sleep / stable-window / pose-stable-window / cluster-assist / timeout）
    │
    ▼
Engine 切换 settled，不再续排连续 rAF；回调 GameController.onSettled():
    5. dice/read-face.ts → readAllFacesDetailed() → 读取 6 颗骰子朝上点数 + 置信度
    6. rules/judge.ts → 判定奖级 → 返回 JudgeResult 完整对象
    7. 线速度/角速度清零并 sleep，确保后续姿态不漂移
    8. 检测倾斜骰子：confidence < tiltThreshold（0.75，≈41°）
    9. 回调返回后，Engine 用最终 raw body pose 渲染结算帧
    │
    ├── 无倾斜 → store.setResult()（applyResult：写入 diceValues、result、round++、history、prizeRecord）
    │                │
    │                ▼
    │          React UI 响应 → ResultPanel + PrizeRecord + History + ThrowButton 恢复
    │
    └── 有倾斜 → store.setPending({ diceValues, result, tiltedIndices })
                     │  写入 diceValues + currentResult 供 UI 预览
                     │  不写入 history / prizeRecord / round（隔离）
                     │
                     ▼
               TiltWarning 组件显示倾斜提示
                     │
                     ├── 用户点击「接受结果」→ controller.acceptTilted()
                     │     → store.commitPending()（调用 applyResult 提交）
                     │     → phase = 'result'
                     │
                     └── 用户点击「重掷」→ controller.rethrow()
                           → store.clearPending()（phase = 'rolling'）
                           → throwDice() + engine.beginSettle()
```

## 引擎渲染状态机

引擎状态与下文 Zustand/UI 的 `phase` 相互协作，但不是同一组状态：UI 使用 `idle / rolling / tilt-confirm / result` 表达业务流程；引擎只关心渲染和物理调度。

| Engine mode | 进入方式                            | 物理与渲染行为                                                                                                |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `stopped`   | 初始状态，或调用 `stop()/dispose()` | 取消待执行 rAF，不推进物理，也不接受失效渲染                                                                  |
| `idle`      | `start()` 将 stopped 切换为 idle    | 启动时渲染一帧 raw pose；之后不常驻 rAF，`invalidate()` 只合并调度一个静态帧                                  |
| `rolling`   | `beginSettle()`                     | 唯一连续 rAF；按固定时间步长推进 cannon-es，未停稳帧使用 `interpolatedPosition / interpolatedQuaternion` 渲染 |
| `settled`   | `checkSettled()` 返回结构化结果     | 调用 controller 完成读面与冻结，再以 raw `position / quaternion` 渲染最终帧；之后按需单帧                     |

`start()` / `invalidate()` 通过同一个 `rafId` 去重，因此连续的静态失效请求最多合并成一个待执行帧。`rolling` 已有连续循环，额外 `invalidate()` 是无操作。

### 渲染质量、阴影与 resize 失效

- `config/render.ts` 将有效 DPR 限制在 `1.0～1.5`，并以 `3,500,000` 个 drawing-buffer 像素为目标预算；计算出的预算 DPR 低于 1 时仍保持最低 1x，因此 CSS 视口自身已超过预算的极端场景允许超出目标值。
- 未触发像素预算限制时使用 `1024 × 1024` 阴影贴图；触发限制时降为 `512 × 512`，切档时释放旧阴影 map 并请求重建。
- rolling 期间阴影 `autoUpdate=true`；idle/settled 静态帧关闭自动更新，仅将 `needsUpdate` 置为 true 后刷新一次。
- `scene/setup.ts` 只在 CSS 尺寸或设备 DPR 实际变化时重算 renderer 尺寸、有效 DPR、camera preset/aspect 和阴影档位；`GameViewport` 将 resize 失效回调绑定到 `engine.invalidate()`，cleanup 时解绑。静态状态因此补渲一个合并帧，rolling 状态则沿用正在运行的连续帧。
- 开发环境与隔离的 e2e 构建把 diagnostics 写入 canvas 的 `data-dice-diagnostics`；普通生产构建不发布该数据集。每份快照带 `schemaVersion / revision / sampleKind: 'post-render'`，且只在一次真实 `renderer.render()` 完成后发布，避免把上一帧的 `renderer.info` 与新引擎状态错误配对。
- `mainPassCalls / mainPassTriangles` 明确表示 renderer 主 pass 的调用数和三角形数，不冒充包含 shadow pass 的总量；`geometries / textures` 来自 `renderer.info.memory`，并附带当前 `programs` 数量、CSS/drawing-buffer 尺寸、DPR 与 Engine 调度计数。投掷诊断同时记录实际 seed、rejection/fallback 路径、fallback layout、停稳原因与模拟耗时。
- Playwright 的 `test:e2e` 在 `1920×873@2x` 桌面项目和 `390×844@3x` 移动项目中执行真实 `throwDice()` 的固定 seed 单轮、结果提交、reset 与静态零帧验收。`bench:browser` 对三种引擎阶段锁定 8 个主 pass calls、41,288 个三角形、8 个 geometry、最多 6 个 texture、DPR/3.5MP drawing-buffer 预算和分平台 shader program 上限；rAF 帧时只记录到 JSON，不作为跨硬件硬门槛。失败时保留 JSON、页面截图、video 与 trace。

### 移动端与低动态环境的 CSS 合成降级

- 桌面默认保留玻璃模糊和 rolling 按钮的光晕动效；`max-width: 768px` 时只关闭 `.top-bar / .tilt-warning / .result-panel / .panel-card` 等大面积区域的 `backdrop-filter`，以高不透明度实色背景补偿，小面积 `.btn-icon` 仍保留原样。
- 移动端 rolling 按钮禁用会逐帧重绘 `box-shadow` 的 `buttonPulse`，但保留基于 `transform / opacity` 的 ornament 动效。
- `(update: slow)` 环境采用大面积模糊回退，并关闭 rolling 按钮、ornament、倾斜提示和结果面板动画。`prefers-reduced-motion: reduce` 只关闭动画、按钮过渡和 hover 位移，不额外牺牲桌面 blur 等静态视觉；这些规则不全局移除其他阴影。

## 游戏状态机

```text
        throw()                        onSettled()
IDLE ──────────▶ ROLLING ──────────────────────────▶ RESULT
  ▲                                       │            │
  │                                       │ 有倾斜     │
  │              reset() 或               ▼            │
  │              下一轮 throw()     TILT-CONFIRM       │
  │                                   │       │        │
  │                              accept()  rethrow()   │
  │                                   │       │        │
  │                                   ▼       ▼        │
  │                                RESULT   ROLLING    │
  │                                   │                │
  └───────────────────────────────────┴────────────────┘
```

| Phase          | UI 状态                                 | 引擎行为                                                            |
| -------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `idle`         | 掷骰按钮可用，等待操作                  | Engine idle；骰子静止，只有启动/resize 等失效请求触发静态单帧       |
| `rolling`      | 按钮禁用，显示"骰子翻滚中"              | Engine rolling；施加初速度 → 连续 rAF 物理步进与插值渲染 → 停稳检测 |
| `tilt-confirm` | 按钮禁用，TiltWarning 显示（接受/重掷） | Engine settled；骰子已冻结，无常驻 rAF，等待用户决策                |
| `result`       | 显示结果面板，按钮恢复为"再掷一次"      | Engine settled；骰子静止，无常驻 rAF，等待下一轮、重置或失效单帧    |

说明：不再区分 throwing 和 settling。对 UI 来说两者表现完全一致（按钮禁用），合并为 rolling 减少边界管理复杂度。tilt-confirm 为倾斜确认态，骰子物理体已冻结，结果数据预写入 store 供 UI 预览但不提交至历史记录，等待用户选择接受或重掷。

## Zustand Store 结构（概要）

```ts
// 判定结果完整对象
interface JudgeResult {
  prize: Prize // 奖级枚举
  priority: number // 优先级数值（越小越高）
  carryScore: number // 带数（剩余骰子之和，无带数时为 0）
  matchedDice: number[] // 命中规则的骰子点数
  remainDice: number[] // 剩余骰子点数
  description: string // 人类可读描述，如"状元 带7"
}

// 倾斜骰子待提交数据
interface PendingSettlement {
  diceValues: number[]
  result: JudgeResult
  tiltedIndices: number[] // 倾斜骰子下标（0-based）
}

interface GameState {
  // 状态
  phase: 'idle' | 'rolling' | 'tilt-confirm' | 'result'
  round: number
  diceValues: number[] // 当轮 6 颗骰子点数
  currentResult: JudgeResult | null // 当轮完整判定结果
  history: HistoryEntry[] // 最近 HISTORY_MAX_LENGTH 轮历史（默认 5，来自 config/ui.ts）
  prizeRecord: Record<Prize, number> // 累计各奖级次数
  pendingSettlement: PendingSettlement | null // 倾斜确认期间暂存
  soundEnabled: boolean
  playerId: string | null // 预留多人，当前默认 null

  // 纯状态设置器（仅由 GameController 调用，不对 UI 直接暴露业务语义）
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: { diceValues: number[]; result: JudgeResult }) => void // 无倾斜时直接结算（内部调用 applyResult）
  setPending: (p: PendingSettlement) => void // 有倾斜：预写 diceValues/currentResult，不提交历史
  commitPending: () => void // 用户接受倾斜结果：调用 applyResult 提交
  clearPending: () => void // 用户选择重掷：清空 pending，phase → rolling
  resetState: () => void
  toggleSound: () => void
}

// applyResult 为 setResult 和 commitPending 共用的内部辅助函数，
// 负责 round++、追加 history（限 HISTORY_MAX_LENGTH）、更新 prizeRecord、设置 phase='result'。
```

注意：UI 组件只通过 selector 读取 store，所有业务操作（掷骰、重置）通过 GameController 实例方法调用，不直接调用 store 的 set 方法。

## 移动端布局不变量

- 移动端采用真实上下布局：上方为游戏舞台，下方为文档流中的内容区；内容增长时依赖页面整体滚动，而不是固定底部浮层。
- `ResultPanel / TiltWarning` 位于下方内容区顶部，可通过负外边距轻度侵入上下分界线，制造悬浮感，但 DOM 仍属于内容区。
- `ThrowButton` 始终位于结算卡之后，仍是移动端唯一主操作入口。
- `PrizeRecord / History` 位于按钮之后，不再使用独立内部滚动容器抢占视口；内容变多时直接推动页面向下滚动。
- 初始态下方内容区默认不整块展开，只保留一条轻提示边提醒用户下方存在记录区；一旦出现结算、累计或历史内容，再切回真实内容区。
- 该移动端布局只改变展示层的文档流与层级，不改变掷骰、结算、重掷、重置等业务流程。

## 奖级优先级表（确认版）

| 优先级 | 奖级       | 判定条件               | 备注                       |
| ------ | ---------- | ---------------------- | -------------------------- |
| 1      | 状元插金花 | 4 个四 + 2 个一        | 最高奖                     |
| 2      | 满堂红     | 6 个四                 |                            |
| 3      | 遍地锦     | 6 个一                 |                            |
| 4      | 六子       | 6 个相同（非四非一）   | 按点数排序：6 最大，2 最小 |
| 5      | 五红       | 5 个四                 |                            |
| 6      | 五子登科   | 5 个相同（非四）       |                            |
| 7      | 状元       | 4 个四（不满足插金花） |                            |
| 8      | 对堂       | 1-2-3-4-5-6 各一       |                            |
| 9      | 三红       | 3 个四                 |                            |
| 10     | 四进       | 4 个相同（非四）       |                            |
| 11     | 二举       | 2 个四                 |                            |
| 12     | 一秀       | 1 个四                 |                            |
| 13     | 未中奖     | 无匹配                 |                            |

**带数规则**：同一奖级下，除完全满足规则的骰子外，剩余骰子求和为“带数”，带数大者优先。所有存在剩余骰子的奖级均计算带数，具体包括：五红、五子登科、状元、三红、四进、二举、一秀。完全满足 6 颗的奖级（状元插金花、满堂红、遍地锦、六子、对堂）无剩余骰子，带数为 0。例如状元 [4,4,4,4,1,5] 带 6，[4,4,4,4,1,6] 带 7，后者胜出。

## 碗碰撞体方案

采用 Heightfield 连续曲面 + 竖直挡墙，不使用 Trimesh：

- **碗底**：1 个 Heightfield（51×51 网格），高度由共享曲线 `bowlInnerHeight` 生成，碗底中心零高度、边缘陡峭
- **挡墙**：16 个竖直薄 Box 环形排列于碗口内侧，底部埋入 Heightfield 保证过渡无缝隙，仅防逃出、不拟合曲面
- **逃逸防护**：引擎帧循环中，每帧检测骰子 Y > `ESCAPE_Y`（0.9m）且向上运动时，反射纵向速度并衰减 0.3 倍（`vy = -vy * 0.3`），替代物理盖碰撞体，避免盖子与投掷初始高度冲突
- **桌面**：1 个大平面作为兜底碰撞面，防止极端情况骰子穿出场景

碗内壁曲线（纯幂函数零偏移）定义在 `config/bowl.ts`，物理层和渲染层共用同一函数，消除几何分叉。

### 骰子碰撞体

当前运行时默认回退为 Box（8v/6f）；chamfer `ConvexPolyhedron`（24v/14f）仍保留在 sweep / 对照脚本中，用于继续评估物理权衡：

- **倒角生成**：`dice/chamfer.ts` → `createChamferedCubeHull(halfSize, chamfer)`，每个原始顶点切出 3 个新顶点，产生 8 个三角形面 + 6 个八边形面
- **参数**：`PHYSICS.diceChamferRatio = 0`（运行时默认 box），`shapeMode: 'box' | 'chamfer'` 可切换；sweep 层独立保留 `0.15` 作为 chamfer 基线
- **效果**：减少骰子棱边互锁导致的倾斜停稳（200-seed tilt: 2 → 0），代价是 `world.step()` 耗时约 3.2x
- **阻尼补偿**：chamfer 圆角使骰子更易滚动，`linearDamping`/`angularDamping` 从 0.30 提升到 0.35 以补偿（timeout 率: 18% → 8%）
- **视觉对齐**：`RoundedBoxGeometry` 连续圆角作为视觉近似，radius 对齐物理倒角参数

## 测试策略

| 层级                   | 模块                                                    | 测试重点                                                                                                                                                                                                         | 方法                                                          |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 规则穷举               | `rules/judge.ts`                                        | 46656 种有序结果全扫，每组只命中一个最高优先级，返回完整 JudgeResult                                                                                                                                             | Vitest 参数化穷举                                             |
| 规则示例               | `rules/judge.ts`                                        | 全部 13 种奖级的典型用例 + 带数计算正确性                                                                                                                                                                        | 纯函数单测                                                    |
| 点数读取               | `dice/read-face.ts`                                     | 24 个立方体合法朝向 + 近边界轻微扰动样本                                                                                                                                                                         | 构造已知四元数                                                |
| 停稳检测               | `dice/settle.ts`                                        | natural/low-speed/pose-stable/timeout 路径；pose 开关、位移/角距/读面窗口与刚体不变性                                                                                                                            | 假时钟 + 快照序列                                             |
| 接触簇辅助             | `dice/contact-cluster-assist.ts`                        | 默认禁用；历史 variant 的 activationDelay、簇大小、簇外活跃骰子和介入诊断                                                                                                                                        | node 环境纯逻辑单测                                           |
| 投掷与随机计划         | `dice/throw.ts` + `utils/random.ts`                     | 6 槽几何、整体旋转/槽位打乱、layout/dynamics 子流隔离、算法/计划版本                                                                                                                                             | 固定 seed + 随机单位值快照                                    |
| 物理 A/B               | `physics/roll-runner.ts` + `physics/roll-comparison.ts` | 命名 preset、A/B-B/A 交替、watch/batch cohort、非自然结算 20s continuation 真值与安全性                                                                                                                          | 统一 runner + 固定 seed + 结构化汇总                          |
| 引擎调度与姿态         | `game/engine.ts` + `physics/body-transform.ts`          | idle/settled 按需单帧、rolling 连续帧、stop 取消调度、rolling interpolated pose、结算 raw pose、teleport 状态同步                                                                                                | mock rAF/renderer + 真实 Cannon Body                          |
| 骰子实例与资源生命周期 | `dice/create.ts` + `GameViewport.tsx`                   | 单材质 atlas InstancedMesh、6 个 body/proxy、矩阵索引同步、dispose 幂等、StrictMode 重挂载不复用已释放贴图                                                                                                       | Three 对象断言 + dispose spy + React StrictMode 重挂载        |
| 渲染质量与 resize      | `config/render.ts` + `scene/setup.ts`                   | DPR 1.5 上限、350 万像素预算、1024/512 阴影档位、重复 resize 去重、resize 失效通知、不创建 PMREM                                                                                                                 | 纯质量函数 + mock WebGLRenderer/ResizeObserver/PMREMGenerator |
| 开发态渲染诊断         | `GameViewport.tsx`                                      | 主 pass calls/triangles 命名、renderer memory/programs 与 drawing-buffer/DPR 字段，生产态不发布                                                                                                                  | mock renderer.info + dataset 断言                             |
| CSS 合成降级契约       | `ui/styles/game.css`                                    | 桌面 backdrop/光晕规则仍在；移动端与 slow-update 关闭大面积 blur 和 rolling box-shadow 动画；reduced-motion 单独关闭运动且保留静态视觉                                                                           | 读取 CSS 文本并限定媒体查询块断言                             |
| 编排集成               | `game/controller.ts`                                    | phase 变化正确、rolling 中二次点击被拒、rolling 中 reset 被拒、history 只保留最近 HISTORY_MAX_LENGTH 轮、reset 清理当轮+累计、sound toggle 不影响主流程                                                          | mock dice/judge/engine                                        |
| 倾斜确认流程           | `game/controller.ts` + `store.ts`                       | onSettled 倾斜检测→tilt-confirm、35° 靠壁正常姿态不触发、pending 隔离（不写 history/prizeRecord/round）、acceptTilted 提交完整内容、rethrow 重新投掷、throw 在 tilt-confirm 被拒、reset 清空 pending、冻结一致性 | 构造已知四元数 mock DicePair，settleWithoutThrow 跳过随机投掷 |
| 物理烟雾               | 物理层整体                                              | 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能在预期时间内结算或触发超时                                                                                                      | 固定种子 + 帧循环                                             |

**随机数可复现**：`utils/random.ts` 默认以时间种子初始化 mulberry32，也支持固定 seed、测试随机源注入和带 salt 的独立子流。投掷 v3 在诊断中同时记录 seed、位置算法和 random-plan 版本，不把单一裸 seed 当作跨版本复现保证。

### 统一物理门禁与当前基线

| 命令                              | 用途                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `pnpm test:physics`               | watch seeds 与物理/停稳回归的快速提交前门禁                       |
| `pnpm test:seed -- --seed=<seed>` | 单 seed 结构化复现                                                |
| `pnpm test:acceptance`            | 默认 200 seeds；assist/fallback 预算均为 0，pose-stable 不超过 2% |
| `pnpm test:physics:ab`            | 命名 variant 的 watch/batch A/B 与 natural continuation 门禁      |

当前 `stratified-ring + assist off + pose on` 用统一 runner 执行的本机 2000 个固定逻辑 seed 样本中，`natural-sleep=1990`、`pose-stable-window=10`，timeout / NaN / wall crossing / escape-guard / assist / fallback 均为 0；结算时间 p95=3.3s、p99=4.8s、max=8.2s，`maxContactPenetration=0.081546`。10 个 pose-stable 样本均追加了 20s natural continuation：逐骰面值、倾斜分类、完整奖级与轨迹安全无差异；其中 seed 1673000 在 20s 预算内仍未被 Cannon 标记为 sleep，作为 exhausted 参考显式保留。聚合 12000 颗终态骰子的六面计数为 `[1984, 2046, 2009, 1984, 1973, 2004]`，按骰位计数也写入验收报告，仅作为扩大公平性研究前的观察值。以上是固定时间步的 Node 逻辑样本，用于当前算法回退对照，不是浏览器 FPS、wall-clock 性能或跨机器普适结论。

默认 `historical → current` A/B 共 200 个 seed，其中 19 个历史问题 seed 单列为 watch、181 个普通 seed 用于 batch 回退预算。当前实现通过门禁：batch 的 fallback 从 56.35% 降为 0，assist 从 34 轮降为 0，最大接触穿透从 0.083572 降为 0.066890；逻辑结算 p95 减少 0.1167s、p99 增加 0.25s，均在预先设定的回退预算内。watch seed 只承担真实性与安全回归，不混入这些分布预算。

### 独立 sweep 脚本

长时间运行的参数扫描、统计类测试已从 vitest 套件中拆出，放在 `sweep/` 目录下作为独立 `vite-node` 脚本运行。**不要将这些脚本重新写回 `src/__tests__/` 或注册为 vitest 测试。**

| 命令                                                 | 脚本                                 | 用途                                           | 典型耗时       | CLI 参数                       |
| ---------------------------------------------------- | ------------------------------------ | ---------------------------------------------- | -------------- | ------------------------------ |
| `pnpm sweep:param`                                   | `sweep/param-sweep.ts`               | box vs chamfer 多摩擦/恢复系数组合对比         | 5-30min        | `--seeds=N --variant=0,1`      |
| `pnpm sweep:sleep`                                   | `sweep/sleep-sweep.ts`               | sleepTimeLimit 值对停稳路径的影响              | 2-5min         | `--seeds=N --values=0.32,0.28` |
| `pnpm sweep:timeout`                                 | `sweep/timeout-risk.ts`              | 大批量种子的超时率统计                         | 3-10min        | `--seeds=N`（默认 500）        |
| `pnpm sweep:jitter`                                  | `sweep/jitter-diagnose.ts`           | 特定种子的抖动峰值角诊断                       | 2-5min         | `--seeds=... --variant=0,1`    |
| `pnpm sweep:tilt`                                    | `sweep/tilt-stats.ts`                | 倾斜骰子概率分布统计                           | 1-3min         | `--trials=N`（默认 200）       |
| `pnpm sweep:bench`                                   | `sweep/shape-bench.ts`               | box / chamfer 形状性能对比基准                 | 1-3min         | `--steps=N --variant=0,1`      |
| `pnpm sweep:contact-eq`                              | `sweep/contact-equation-sweep.ts`    | 接触方程参数扫描                               | 3-10min        | `--seeds=N --values=...`       |
| `pnpm sweep:contact-grid`                            | `sweep/contact-equation-grid.ts`     | 接触方程参数网格搜索                           | 5-20min        | `--seeds=N`                    |
| `pnpm sweep:contact-validate`                        | `sweep/contact-equation-validate.ts` | 对候选接触方程参数做复验                       | 3-10min        | `--seeds=N --preset=...`       |
| `pnpm sweep:solver-ab`                               | `sweep/solver-ab.ts`                 | solver 相关参数 A/B 对比                       | 3-10min        | `--seeds=N --variant=...`      |
| `pnpm sweep:parallel -- --jobs=2 sleep timeout tilt` | `scripts/run-sweeps.mjs`             | 多进程并发执行多个独立 sweep 脚本              | 取决于最长脚本 | `--jobs=N` + 任务名列表        |
| `pnpm sweep:parallel:core`                           | `scripts/run-sweeps.mjs`             | 并发执行 sleep / timeout / tilt 三类核心 sweep | 取决于最长脚本 | 预设任务组合                   |

**共享基础设施**（`sweep/lib/`）：

- `log.ts`：`createLogger(name)` → 返回 `Logger`，日志写入 `logs/<name>-<timestamp>.ndjson`，使用 `appendFileSync` 逐条追加防崩溃丢失，同时生成 `.summary.txt`
- `run-trial.ts`：`runTrial(config)` 完整执行一次投掷试验（创建世界→投掷→步进→停稳→读数→销毁），返回 `TrialResult`（seed、settlePath、settleTime、tiltCount、faces 等）；`parseArgs()` 解析 `--key=value` CLI 参数

日志输出到 `logs/` 目录（已在 `.gitignore` 中），`vitest.config.ts` 的 `exclude` 已包含 `sweep/**`。`sweep/` 目录下还存在 `bounce-baseline.ts`、`box-tilt-200seed.ts`、`combo-sweep.ts` 等一次性或历史诊断脚本，这些文件不视为稳定命令接口。

## 实现优先级

1. **P0 — 核心可玩**：物理稳定、点数读取准确、奖级判定正确、流程不卡死
2. **P1 — UI 可用**：React UI 完整、操作反馈明确、移动端可用
3. **P2 — 氛围表现**：中秋装饰、音效、粒子、高级视觉反馈
