# 博饼小游戏 - 技术架构

## 技术栈

| 层面 | 选型 | 版本策略 |
| ---- | ---- | -------- |
| 工程基座 | Vite + TypeScript | latest stable |
| 包管理 | pnpm | latest stable |
| UI 层 | React | 19.x |
| 状态管理 | Zustand | 5.x |
| 3D 渲染 | Three.js（原生命令式，不使用 R3F） | latest stable |
| 物理引擎 | cannon-es（原生命令式） | latest stable |
| 测试 | Vitest | latest stable |
| CSS | 原生 CSS 文件 + CSS Variables | — |

## 架构原则

1. **React 不侵入 3D 层**：Three.js 和 cannon-es 保持命令式调用，React 只负责 DOM UI overlay。Canvas 容器由 GameViewport 组件提供 ref，引擎实例的创建和销毁在该组件的 useEffect 中完成。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，overlay 组件作为 children 渲染在 Provider 内部，确保能通过 useGameController() 获取 controller 实例。
2. **Zustand 单向写入**：Store 的 actions 为纯状态设置器（只做 setState，无业务逻辑）。所有业务流程入口收归 GameController 一处，controller 内部调用 store 设置状态。UI 组件只通过 selector 读取 store，写入权限归 controller。
3. **单一时钟源**：game/engine.ts 拥有唯一 rAF 循环，每帧内顺序执行：物理 world.step → body→mesh 同步 → 停稳检测 → renderer.render。其他模块（world.ts、settle.ts）只暴露纯函数，不自持循环或轮询。
4. **配置集中管理**：所有可调参数（物理、投掷、停稳、UI 常量）集中在 `config/` 下，不散落在业务模块中。
5. **规则数据驱动**：奖级判定规则以可枚举的数据结构定义，按 priority 升序排列（数值越小优先级越高，排在前面），判定函数为纯函数，返回完整结果对象（奖级 + 带数 + 命中详情）。
6. **响应式归 CSS**：布局、按钮尺寸、面板排列等响应式适配交给 CSS 媒体查询。脚本层仅处理 canvas resize、DPR、camera aspect ratio。
7. **核心逻辑可测试**：奖级判定、点数读取、停稳检测为纯函数/可隔离逻辑，Vitest 重点覆盖。随机数源抽为可注入接口，测试时注入确定性种子。
8. **StrictMode 幂等**：引擎初始化和销毁必须幂等。React StrictMode 会在开发环境双调用 effect，GameViewport 的 cleanup 必须完整销毁引擎实例，重建时不产生残留。
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
│   ├── throw.ts                # 投掷参数：速度范围、角速度范围、初始高度
│   ├── settle.ts               # 停稳参数：速度阈值、持续时间、超时上限、倾斜阈值 tiltThreshold（0.75 ≈ 41°）
│   └── ui.ts                   # UI 常量：HISTORY_MAX_LENGTH、INITIAL_ROUND；触摸目标尺寸单一来源 CSS --touch-min
│
├── game/
│   ├── engine.ts               # 运行时：唯一 rAF 循环、物理步进、mesh 同步、停稳检测、渲染、dispose
│   ├── controller.ts           # 游戏编排层：状态机、轮次推进、结算触发、重置（唯一业务入口）
│   └── store.ts                # Zustand store：游戏状态 + 纯状态设置器
│
├── scene/
│   ├── setup.ts                # Three.js 场景、renderer、灯光、摄像机预设（不含 rAF 循环）
│   ├── table.ts                # 圆桌占位模型 + 程序化木纹/圈层；后续可叠桌布
│   ├── bowl.ts                 # 海碗可视模型 + 程序化青花纹样占位
│   └── decorations.ts          # 旧桌面装饰实验文件，当前未接入 GameViewport 运行时
│
├── physics/
│   ├── world.ts                # cannon-es 世界初始化、暴露 world 实例和 step 函数（不自持循环）
│   ├── bowl-body.ts            # 碗碰撞体（Heightfield 连续碗底 + 竖直挡墙）
│   └── materials.ts            # 物理材质定义与接触材质配对
│
├── dice/
│   ├── create.ts               # 骰子 mesh + rigid body 创建（含红四贴图）
│   ├── dice-body.ts            # 骰子物理 body：box / chamfer 形状切换与 FACE_NORMALS
│   ├── throw.ts                # 投掷逻辑：随机位置、速度、角速度（随机数源可注入）
│   ├── settle.ts               # 停稳检测：纯函数，接受骰子状态返回是否停稳（不自持轮询）
│   ├── contact-cluster-assist.ts # 尾段低速接触簇冻结辅助，减少轻碰撞反复打断 stable window
│   └── read-face.ts            # 朝上面读取：六面法线与世界 up 向量点积
│
├── rules/
│   ├── types.ts                # 奖级枚举、JudgeResult 结果对象、规则数据结构类型
│   ├── prizes.ts               # 全部奖级规则表（按 priority 升序排列，数值小 = 优先级高）
│   └── judge.ts                # 判定函数：输入 6 个点数 → 输出 JudgeResult 完整结果对象
│
├── ui/
│   ├── components/
│   │   ├── GameViewport.tsx    # 3D 容器：持有 canvas ref、创建/销毁引擎实例（幂等）；接受 children，通过 Provider 包裹
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
│   └── random.ts               # 可注入随机数源（生产用 Math.random，测试用固定种子）
│
└── __tests__/                  # 快速测试（pnpm test，全量 <30s）
    ├── judge.test.ts           # 奖级判定：全部奖级示例 + 46656 种穷举校验
    ├── read-face.test.ts       # 点数读取：24 个合法朝向 + 近边界扰动样本
    ├── chamfer.test.ts         # 倒角骰子几何验证：顶点/面数、对称性、尺寸
    ├── settle.test.ts          # 停稳检测：假时钟 + 快照序列、多种边界场景
    ├── settle-regression.test.ts # 停稳回归：已知问题种子的结算路径验证
    ├── controller.test.ts      # 编排层集成：phase 变化、重复点击、history 上限、reset、sound
    ├── engine-timing.test.ts   # 引擎时序：帧循环执行顺序验证
    ├── tilt-flow.test.ts       # 倾斜确认流程：tilt-confirm 进入/pending 隔离/接受/重掷/throw 拒绝/reset/冻结/35° 不触发
    ├── physics-smoke.test.ts   # 物理烟雾：真实世界 + 碗 + 骰子，固定种子跑 N 帧，无 NaN/不穿模
    ├── bowl-body.test.ts       # 碗碰撞体：Heightfield 几何、挡墙布局
    ├── dice-escape.test.ts     # 骰子逃逸防护：多种子验证反弹后不飞出
    ├── throw-geometry.test.ts  # 投掷几何：初始位置/速度分布验证
    ├── throw-invariants.test.ts # 投掷不变量：确定性种子结果一致性
    ├── fallback-rate.test.ts   # fallback 触发率统计
    ├── freeze-consistency.test.ts # 冻结一致性：冻结帧 vs 非冻结帧结果一致
    ├── contact-cluster-assist.test.ts # 尾段接触簇冻结辅助逻辑
    ├── reproduce-seed.test.ts  # 关键种子复现：已知问题种子的详细诊断
    └── review-verify.test.ts   # 审查验证：高度分层、fallback 拓扑覆盖、关键种子复现

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
- 这类视觉占位的目标是先稳定构图与层次，不改变物理世界、碰撞体和游戏状态流。

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
    3. dice/throw.ts → 设置骰子初始位置、速度、角速度
    │
    ▼
Engine rAF 循环（game/engine.ts，唯一时钟源）：
    每帧顺序执行：
    ① physics/world.ts → world.step()
    ② body → mesh 位置/旋转同步
    ③ dice/settle.ts → checkSettled()（纯函数，返回 boolean）
    ④ scene/setup.ts → renderer.render()
    │
    ▼
settle 返回 true（全部 sleep 或速度持续低于阈值 或 超时兜底）
    │
    ▼
Engine 回调 → GameController.onSettled():
    4. dice/read-face.ts → readAllFacesDetailed() → 读取 6 颗骰子朝上点数 + 置信度
    5. 冻结所有骰子物理体（mass=0，速度清零，sleep），确保后续姿态不漂移
    6. rules/judge.ts → 判定奖级 → 返回 JudgeResult 完整对象
    7. 检测倾斜骰子：confidence < tiltThreshold（0.75，≈41°）
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

| Phase | UI 状态 | 引擎行为 |
| ----- | ------- | -------- |
| `idle` | 掷骰按钮可用，等待操作 | 骰子静止在碗中或初始位置 |
| `rolling` | 按钮禁用，显示"骰子翻滚中" | 施加初速度 → 物理步进 → 停稳检测，全过程统一阶段 |
| `tilt-confirm` | 按钮禁用，TiltWarning 显示（接受/重掷） | 骰子已冻结，等待用户决策 |
| `result` | 显示结果面板，按钮恢复为"再掷一次" | 骰子静止，等待下一轮或重置 |

说明：不再区分 throwing 和 settling。对 UI 来说两者表现完全一致（按钮禁用），合并为 rolling 减少边界管理复杂度。tilt-confirm 为倾斜确认态，骰子物理体已冻结，结果数据预写入 store 供 UI 预览但不提交至历史记录，等待用户选择接受或重掷。

## Zustand Store 结构（概要）

```ts
// 判定结果完整对象
interface JudgeResult {
  prize: Prize              // 奖级枚举
  priority: number          // 优先级数值（越小越高）
  carryScore: number        // 带数（剩余骰子之和，无带数时为 0）
  matchedDice: number[]     // 命中规则的骰子点数
  remainDice: number[]      // 剩余骰子点数
  description: string       // 人类可读描述，如"状元 带7"
}

// 倾斜骰子待提交数据
interface PendingSettlement {
  diceValues: number[]
  result: JudgeResult
  tiltedIndices: number[]           // 倾斜骰子下标（0-based）
}

interface GameState {
  // 状态
  phase: 'idle' | 'rolling' | 'tilt-confirm' | 'result'
  round: number
  diceValues: number[]              // 当轮 6 颗骰子点数
  currentResult: JudgeResult | null // 当轮完整判定结果
  history: HistoryEntry[]           // 最近 HISTORY_MAX_LENGTH 轮历史（默认 5，来自 config/ui.ts）
  prizeRecord: Record<Prize, number>  // 累计各奖级次数
  pendingSettlement: PendingSettlement | null  // 倾斜确认期间暂存
  soundEnabled: boolean
  playerId: string | null           // 预留多人，当前默认 null

  // 纯状态设置器（仅由 GameController 调用，不对 UI 直接暴露业务语义）
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: {
    diceValues: number[]
    result: JudgeResult
  }) => void                         // 无倾斜时直接结算（内部调用 applyResult）
  setPending: (p: PendingSettlement) => void  // 有倾斜：预写 diceValues/currentResult，不提交历史
  commitPending: () => void           // 用户接受倾斜结果：调用 applyResult 提交
  clearPending: () => void            // 用户选择重掷：清空 pending，phase → rolling
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

| 优先级 | 奖级 | 判定条件 | 备注 |
| ------ | ---- | -------- | ---- |
| 1 | 状元插金花 | 4 个四 + 2 个一 | 最高奖 |
| 2 | 满堂红 | 6 个四 | |
| 3 | 遍地锦 | 6 个一 | |
| 4 | 六子 | 6 个相同（非四非一） | 按点数排序：6 最大，2 最小 |
| 5 | 五红 | 5 个四 | |
| 6 | 五子登科 | 5 个相同（非四） | |
| 7 | 状元 | 4 个四（不满足插金花） | |
| 8 | 对堂 | 1-2-3-4-5-6 各一 | |
| 9 | 三红 | 3 个四 | |
| 10 | 四进 | 4 个相同（非四） | |
| 11 | 二举 | 2 个四 | |
| 12 | 一秀 | 1 个四 | |
| 13 | 未中奖 | 无匹配 | |

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

| 层级 | 模块 | 测试重点 | 方法 |
| ---- | ---- | -------- | ---- |
| 规则穷举 | `rules/judge.ts` | 46656 种有序结果全扫，每组只命中一个最高优先级，返回完整 JudgeResult | Vitest 参数化穷举 |
| 规则示例 | `rules/judge.ts` | 全部 13 种奖级的典型用例 + 带数计算正确性 | 纯函数单测 |
| 点数读取 | `dice/read-face.ts` | 24 个立方体合法朝向 + 近边界轻微扰动样本 | 构造已知四元数 |
| 停稳检测 | `dice/settle.ts` | 全 sleep 直接结算、低速窗口被中断重计时、单骰未停、超时兜底、阈值抖动不提前结算 | 假时钟 + 快照序列 |
| 接触簇辅助 | `dice/contact-cluster-assist.ts` | activationDelay、生效簇大小、簇外活跃骰子存在时不得介入、持续时间满足后冻结 | node 环境纯逻辑单测 |
| 编排集成 | `game/controller.ts` | phase 变化正确、rolling 中二次点击被拒、rolling 中 reset 被拒、history 只保留最近 HISTORY_MAX_LENGTH 轮、reset 清理当轮+累计、sound toggle 不影响主流程 | mock dice/judge/engine |
| 倾斜确认流程 | `game/controller.ts` + `store.ts` | onSettled 倾斜检测→tilt-confirm、35° 靠壁正常姿态不触发、pending 隔离（不写 history/prizeRecord/round）、acceptTilted 提交完整内容、rethrow 重新投掷、throw 在 tilt-confirm 被拒、reset 清空 pending、冻结一致性 | 构造已知四元数 mock DicePair，settleWithoutThrow 跳过随机投掷 |
| 物理烟雾 | 物理层整体 | 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能在预期时间内结算或触发超时 | 固定种子 + 帧循环 |

**随机数可注入**：`utils/random.ts` 提供可替换的随机数源接口，生产环境使用 `Math.random`，测试时注入确定性种子生成器，确保投掷、物理烟雾和编排测试的稳定性。

### 独立 sweep 脚本

长时间运行的参数扫描、统计类测试已从 vitest 套件中拆出，放在 `sweep/` 目录下作为独立 `vite-node` 脚本运行。**不要将这些脚本重新写回 `src/__tests__/` 或注册为 vitest 测试。**

| 命令 | 脚本 | 用途 | 典型耗时 | CLI 参数 |
| ---- | ---- | ---- | -------- | -------- |
| `pnpm sweep:param` | `sweep/param-sweep.ts` | box vs chamfer 多摩擦/恢复系数组合对比 | 5-30min | `--seeds=N --variant=0,1` |
| `pnpm sweep:sleep` | `sweep/sleep-sweep.ts` | sleepTimeLimit 值对停稳路径的影响 | 2-5min | `--seeds=N --values=0.32,0.28` |
| `pnpm sweep:timeout` | `sweep/timeout-risk.ts` | 大批量种子的超时率统计 | 3-10min | `--seeds=N`（默认 500） |
| `pnpm sweep:jitter` | `sweep/jitter-diagnose.ts` | 特定种子的抖动峰值角诊断 | 2-5min | `--seeds=... --variant=0,1` |
| `pnpm sweep:tilt` | `sweep/tilt-stats.ts` | 倾斜骰子概率分布统计 | 1-3min | `--trials=N`（默认 200） |
| `pnpm sweep:bench` | `sweep/shape-bench.ts` | box / chamfer 形状性能对比基准 | 1-3min | `--steps=N --variant=0,1` |
| `pnpm sweep:contact-eq` | `sweep/contact-equation-sweep.ts` | 接触方程参数扫描 | 3-10min | `--seeds=N --values=...` |
| `pnpm sweep:contact-grid` | `sweep/contact-equation-grid.ts` | 接触方程参数网格搜索 | 5-20min | `--seeds=N` |
| `pnpm sweep:contact-validate` | `sweep/contact-equation-validate.ts` | 对候选接触方程参数做复验 | 3-10min | `--seeds=N --preset=...` |
| `pnpm sweep:solver-ab` | `sweep/solver-ab.ts` | solver 相关参数 A/B 对比 | 3-10min | `--seeds=N --variant=...` |
| `pnpm sweep:parallel -- --jobs=2 sleep timeout tilt` | `scripts/run-sweeps.mjs` | 多进程并发执行多个独立 sweep 脚本 | 取决于最长脚本 | `--jobs=N` + 任务名列表 |
| `pnpm sweep:parallel:core` | `scripts/run-sweeps.mjs` | 并发执行 sleep / timeout / tilt 三类核心 sweep | 取决于最长脚本 | 预设任务组合 |

**共享基础设施**（`sweep/lib/`）：

- `log.ts`：`createLogger(name)` → 返回 `Logger`，日志写入 `logs/<name>-<timestamp>.ndjson`，使用 `appendFileSync` 逐条追加防崩溃丢失，同时生成 `.summary.txt`
- `run-trial.ts`：`runTrial(config)` 完整执行一次投掷试验（创建世界→投掷→步进→停稳→读数→销毁），返回 `TrialResult`（seed、settlePath、settleTime、tiltCount、faces 等）；`parseArgs()` 解析 `--key=value` CLI 参数

日志输出到 `logs/` 目录（已在 `.gitignore` 中），`vitest.config.ts` 的 `exclude` 已包含 `sweep/**`。`sweep/` 目录下还存在 `bounce-baseline.ts`、`box-tilt-200seed.ts`、`combo-sweep.ts` 等一次性或历史诊断脚本，这些文件不视为稳定命令接口。

## 实现优先级

1. **P0 — 核心可玩**：物理稳定、点数读取准确、奖级判定正确、流程不卡死
2. **P1 — UI 可用**：React UI 完整、操作反馈明确、移动端可用
3. **P2 — 氛围表现**：中秋装饰、音效、粒子、高级视觉反馈
