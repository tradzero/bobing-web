# 博饼小游戏 - 开发 Checklist

## 阶段〇：项目初始化

- [x] 0.1 [实现] pnpm create vite（React + TypeScript 模板），生成项目骨架和 package.json
- [x] 0.2 [实现] 安装核心依赖：three、cannon-es、zustand
- [x] 0.3 [实现] 安装开发依赖：@types/three、vitest、jsdom、@testing-library/react
- [x] 0.4 [实现] 配置 ESLint + Prettier（含 React/TS 规则集）
- [x] 0.5 [实现] 配置 Vitest（vitest.config.ts，默认 environment: 'jsdom'；纯函数测试文件可用注释覆盖为 node 环境）
- [x] 0.6 [实现] 配置 tsconfig.json 路径别名（如 `@/` → `src/`）
- [x] 0.7 [实现] 创建目录结构骨架（config/、game/、scene/、physics/、dice/、rules/、ui/components/、ui/styles/、audio/、utils/、**tests**/）
- [x] 0.8 [验收] 验证 `pnpm dev` 能正常启动空白页面
- [x] 0.9 [验收] `pnpm build` 通过，无编译错误

---

## 阶段一：核心引擎（P0 — 物理稳定 + 点数读取 + 奖级判定 + 流程不卡死）

### 1A 奖级规则层

- [x] 1A.1 [实现] 定义奖级枚举 `Prize`（状元插金花、满堂红、遍地锦、六子、五红、五子登科、状元、对堂、三红、四进、二举、一秀、未中奖）
- [x] 1A.2 [实现] 定义 `JudgeResult` 完整结果对象类型（prize、priority、carryScore、matchedDice、remainDice、description）
- [x] 1A.3 [实现] 定义规则数据结构类型 `PrizeRule`（name、priority、match 函数、描述）
- [x] 1A.4 [实现] 实现规则表 `prizes.ts`，按 priority 升序排列（数值越小优先级越高，排在前面），每条规则为独立数据项
- [x] 1A.5 [实现] 实现判定函数 `judge(diceValues: number[]): JudgeResult`，返回完整结果对象
- [x] 1A.6 [实现] 实现"带数"计算逻辑：所有存在剩余骰子的奖级均计算带数（五红、五子登科、状元、三红、四进、二举、一秀），完全满足 6 颗的奖级带数为 0
- [x] 1A.7 [实现] 实现六子内部排序逻辑（6 最大，2 最小，排除 6 个 1 和 6 个 4）
- [x] 1A.8 [测试] 编写奖级判定示例单测：覆盖全部 13 种奖级的典型用例
- [x] 1A.9 [测试] 编写边界用例单测：同时满足多条规则时只返回最高优先级
- [x] 1A.10 [测试] 编写"带数"单测：相同奖级下不同带数的排序正确性
- [x] 1A.11 [测试] 编写穷举校验：遍历 46656 种有序结果，验证每组只命中一个最高优先级且输出一致
- [x] 1A.12 [验收] 验证全部测试通过

### 1B Three.js 场景搭建

- [x] 1B.1 [实现] 实现 `scene/setup.ts`：创建 Scene、WebGLRenderer、PerspectiveCamera
- [x] 1B.2 [实现] 设置摄像机为固定俯视 + 轻微倾斜视角，不可交互调节
- [x] 1B.3 [实现] 添加主光源（暖色调 DirectionalLight）+ 环境光（AmbientLight）
- [x] 1B.4 [实现] 实现 canvas resize 监听：仅在 CSS 尺寸或设备 DPR 实际变化时，同步 renderer 尺寸、预算化 pixel ratio、camera preset/aspect 与阴影档位
- [x] 1B.5 [实现] 实现 `scene/table.ts`：圆桌桌面 mesh（圆柱几何体 + 木纹色基础材质）
- [x] 1B.6 [实现] 实现 `scene/bowl.ts`：海碗可视模型（Lathe 几何体或组合几何体，白瓷材质）
- [x] 1B.7 [验收] 验证页面能稳定渲染桌面 + 海碗静态场景
- [x] 1B.8 [实现] 新建 `config/render.ts`：基础 DPR 限制为 1.0～1.5，以 3,500,000 drawing-buffer 像素为目标预算；生产仅在基础质量 reduced 档的 rolling 将有效 DPR 限为 1x，full 档保持基础 DPR，static 一律恢复基础 DPR
- [x] 1B.9 [实现] 渲染质量分档：正常档使用 1024 阴影贴图，像素预算受限档降为 512；切档时释放旧 shadow map 并请求重建
- [x] 1B.10 [实现] 阴影关闭自动更新；静态帧按需刷新一次，rolling 生产默认在每个真实 render 前显式请求更新
- [x] 1B.11 [测试] 覆盖 DPR 上限、drawing-buffer 像素预算、1024/512 阴影档位、重复 resize 去重与 resize 失效通知
- [x] 1B.12 [实现] 删除低价值 PMREM 路径：生成阶段桌面/海碗/骰子尚未加入 scene，且旧实现只保留 texture、丢失 render target 所有权；当前保持 `scene.environment = null`
- [x] 1B.13 [测试] 场景 setup 测试锁定不构造 PMREMGenerator、environment 为空，并覆盖正常 dispose

### 1C cannon-es 物理世界

- [x] 1C.1 [实现] 实现 `config/physics.ts`：集中定义物理参数（重力、步长、子步进数、骰子 sleep 参数）
- [x] 1C.2 [实现] 实现 `physics/world.ts`：创建 cannon-es World，配置重力、broadphase、solver
- [x] 1C.3 [实现] 开启 World.allowSleep（世界级开关）
- [x] 1C.4 [实现] 实现固定时间步长更新函数，与渲染帧率解耦
- [x] 1C.5 [实现] 实现 `physics/materials.ts`：定义骰子材质、碗材质、桌面材质，配置 ContactMaterial 参数（摩擦、弹性）
- [x] 1C.6 [实现] 实现 `physics/bowl-body.ts`：碗底 Heightfield 连续曲面碰撞体（51×51 网格，基于 config/bowl.ts 共享曲线）
- [x] 1C.7 [实现] 实现碗壁碰撞体：16 个竖直薄 Box 挡墙环形排列，底部埋入 Heightfield
- [x] 1C.8 [实现] 添加桌面平面碰撞体作为兜底
- [x] 1C.9 [验收] 验证碗碰撞体组合：投入 6 颗 Box 骰子，连续多次投掷不穿模、不卡在壁面片段拼接缝中、不出现贴壁持续抖动

### 1D 骰子创建

- [x] 1D.1 [实现] 实现 `utils/random.ts`：默认使用时间种子 mulberry32，支持固定 seed、测试源注入和带 salt 的可复现子流
- [x] 1D.2 [实现] 实现 `config/throw.ts`：集中定义投掷参数（速度范围、角速度范围、初始高度范围）
- [x] 1D.3 [实现] 实现 `config/settle.ts`：集中定义停稳参数（速度阈值、角速度阈值、持续时间、超时上限）
- [x] 1D.4 [实现] 实现骰子面纹理生成器（Canvas 2D 绘制）：将 1～6 点绘制到带 gutter 的 3×2 atlas
- [x] 1D.5 [实现] 四点面使用红色绘制，其余面使用黑色
- [x] 1D.6 [实现] 纹理生成模块预留 `createAtlas()` 接口：支持后续替换为相同布局的静态 color/bump/roughness atlas
- [x] 1D.7 [实现] 实现 `dice/create.ts` 单颗兼容接口：创建独立骰子 Mesh（RoundedBoxGeometry + 单材质 atlas）与 body
- [x] 1D.8 [实现] 创建骰子 cannon-es Body（Box shape），关联质量、阻尼参数
- [x] 1D.9 [实现] 为每颗骰子 body 设置 allowSleep=true、sleepSpeedLimit、sleepTimeLimit（参数来自 config/physics.ts）
- [x] 1D.10 [实现] 实现 `createDiceSet()`：运行时使用单材质 atlas InstancedMesh，并创建 6 个独立 Cannon body 与轻量 Object3D 姿态代理
- [x] 1D.11 [实现] 建立 proxy ↔ body ↔ instanceIndex 映射：Engine 写入 raw/interpolated pose 后由 `syncVisual()` 更新对应 instance matrix
- [x] 1D.12 [验收] 验证 6 颗骰子能在场景中正确渲染，材质和点数清晰可辨
- [x] 1D.13 [实现] 新建 `physics/body-transform.ts`：支持 raw/interpolated pose 复制，并在 teleport 后同步 previous/interpolated position 与 quaternion
- [x] 1D.14 [实现] DiceSet 独占 instance buffer、geometry、material、texture，不在每轮投掷重建且不跨 StrictMode 重挂载缓存；提供幂等 `dispose()` 显式释放
- [x] 1D.15 [测试] 覆盖单实例/6 body-proxy、单材质 atlas UV/法线/点数映射、instance matrix 同步、DynamicDrawUsage、dispose 幂等及新集合不复用已释放贴图

### 1E 投掷逻辑

- [x] 1E.1 [实现] 实现 `dice/throw.ts`：批量设置骰子初始布局与动力学状态，随机数源使用 `utils/random.ts`
- [x] 1E.2 [实现] 设置随机初始旋转（四元数随机化）
- [x] 1E.3 [实现] 设置受控随机线速度（向碗中心偏移 + 向下分量）
- [x] 1E.4 [实现] 设置受控随机角速度
- [x] 1E.5 [实现] 唤醒所有骰子 body（清除 sleep 状态）
- [x] 1E.6 [验收] 验证投掷后骰子能自然落入碗中，不飞出画面，不高速穿透
- [x] 1E.7 [实现] 投掷写完最终 position/quaternion（含 fallback 高度覆写）后同步 Cannon 插值状态，避免首个渲染帧从上一轮 pose 插值
- [x] 1E.8 [实现] 投掷 v3 默认使用 `stratified-ring`：6 槽等角分层环，随机整体旋转与骰子-槽位分配，构造路径不使用 fallback
- [x] 1E.9 [实现] 按 seed 派生独立 layout/dynamics 子流，固定 random-plan 版本与每骰动力学随机消费顺序
- [x] 1E.10 [实现] `legacy-v1` 与 `uniform-area-restarts` 保留为命名 A/B 历史/布局对照，不作为运行时默认
- [x] 1E.11 [测试] 锁定 6 槽间距、旋转/打乱、子流隔离、固定 seed 不变量与真实 `throwDice()` 路径诊断

### 1F 停稳检测

- [x] 1F.1 [实现] 实现 `dice/settle.ts`：停稳检测函数 `checkSettled()`，接受骰子状态，返回结构化 `SettleResult | null`（不自持轮询）
- [x] 1F.2 [实现] 实现 sleep 状态检测路径：全部 6 颗骰子 body 进入 sleep 则判定停稳
- [x] 1F.3 [实现] 实现速度阈值检测路径：连续满足 config/settle.ts 中定义的持续时间，所有骰子线速度和角速度均低于配置阈值
- [x] 1F.4 [实现] 实现超时兜底：超过 config/settle.ts 中定义的超时上限后，进入超时兜底结算路径（具体策略在实现时确定，不预设为"强制置零速度"）
- [x] 1F.5 [测试] 编写停稳检测单测：全部 sleep 直接结算
- [x] 1F.6 [测试] 单测：低速窗口被中断后重新计时
- [x] 1F.7 [测试] 单测：只有一颗骰子一直未停，不应提前结算
- [x] 1F.8 [测试] 单测：超时兜底触发
- [x] 1F.9 [测试] 单测：接近阈值反复抖动但不应提前结算
- [x] 1F.10 [验收] 验证全部测试通过
- [x] 1F.11 [实现] 停稳 v4 输出 `natural-sleep / stable-window / pose-stable-window / cluster-assist / timeout` 五种可观测原因
- [x] 1F.12 [实现] 只读 pose-stable 窗口要求 0.75s 内逐骰位移 ≤ 2mm、四元数角距 ≤ 0.015rad 且读面不变；不以瞬时速度噪声预筛，不修改 body
- [x] 1F.13 [实现] contact-cluster assist 运行时默认关闭，仅 historical variant 显式开启以复现旧行为
- [x] 1F.14 [测试] 锁定 pose detector 显式开关、刚体不变性、位移/角距/读面打断以及 seed 1673000 与自然延续结果一致

### 1G 点数读取

- [x] 1G.1 [实现] 定义骰子六个面的本地法线向量常量（±x, ±y, ±z 与点数 1-6 的映射）
- [x] 1G.2 [实现] 实现 `dice/read-face.ts`：将每个面法线通过骰子四元数旋转到世界坐标
- [x] 1G.3 [实现] 计算每个世界法线与 (0, 1, 0) 的点积，取最大值对应面为朝上面
- [x] 1G.4 [实现] 返回 6 颗骰子的朝上点数数组
- [x] 1G.5 [测试] 编写点数读取单测：覆盖 24 个立方体合法朝向（正对正轴的旋转）
- [x] 1G.6 [测试] 编写近边界扰动单测：在合法朝向基础上加微小随机扰动，验证仍能稳定判面
- [x] 1G.7 [验收] 验证全部测试通过

### 1H 运行时与游戏编排层

- [x] 1H.1 [实现] 实现 `game/store.ts`：Zustand store 定义（五态 phase、round、diceValues、currentResult、history、prizeRecord、pendingSettlement、rollError、soundEnabled、playerId）
- [x] 1H.2 [实现] store 预留 playerId 字段（默认 null，多人阶段启用）
- [x] 1H.3 [实现] store actions 为纯状态设置器：覆盖正常结果、倾斜 pending/commit/clear、timeout error/clear、reset 与 toggleSound
- [x] 1H.4 [实现] 实现 `game/engine.ts` 按需唯一 rAF 调度器：显式 `idle / rolling / settled / stopped`；只有 rolling 连续调度，idle/settled 仅启动或失效时单帧，stopped 不调度
- [x] 1H.5 [实现] engine 暴露 start()、stop()、dispose()、beginSettle()、returnToIdle()、invalidate() 与只读 diagnostics；静态失效请求按 rafId 合并
- [x] 1H.6 [实现] rolling 帧使用固定步长推进 physics，未停稳时以 Cannon interpolated pose 渲染；停稳回调完成后以 raw body pose 渲染最终帧
- [x] 1H.7 [实现] 实现 `game/controller.ts`：GameController 类（唯一业务入口）
- [x] 1H.8 [实现] 实现 UI 五态状态机：idle → rolling → result/tilt-confirm/error；result 可直接进入下一轮，tilt-confirm 可接受/重掷，error 可同轮重掷/重置
- [x] 1H.9 [实现] controller.throw()：只允许 idle/result，拒绝 rolling、tilt-confirm 与 error 绕过各自专用恢复路径
- [x] 1H.10 [实现] controller.onSettled()：仅接受 rolling 阶段首个回调；timeout 冻结异常画面并进入 error，其余路径才读面、判奖并分流 result/tilt-confirm
- [x] 1H.11 [实现] controller.reset()：拒绝 rolling；其余状态清空游戏数据但保留 soundEnabled，将骰子放回已同步且休眠的碗底静态姿态，并让引擎回到 idle 后按需渲染一帧
- [x] 1H.12 [实现] controller.toggleSound()：统一的音效开关入口
- [x] 1H.13 [测试] 编写编排层集成测试：phase 变化是否正确
- [x] 1H.14 [测试] 集成测试：rolling 中二次点击 throw() 被拒绝
- [x] 1H.15 [测试] 集成测试：result 阶段直接再次 throw() 能正常进入 rolling
- [x] 1H.16 [测试] 集成测试：结算后 history 只保留最近 HISTORY_MAX_LENGTH 轮（来自 config/ui.ts）
- [x] 1H.17 [测试] 集成测试：reset 清理当轮 + 累计记录
- [x] 1H.18 [测试] 集成测试：rolling 中调用 reset() 被拒绝
- [x] 1H.19 [测试] 集成测试：sound toggle 不影响主流程
- [x] 1H.20 [验收] 验证全部测试通过
- [x] 1H.21 [测试] Engine 调度测试：idle/settled 不常驻 rAF，rolling 独占连续 rAF，stop/dispose 取消待执行帧
- [x] 1H.22 [测试] Engine 姿态测试：rolling 读取 interpolated pose，结算帧读取 controller 回调后的 raw pose
- [x] 1H.23 [实现] diagnostics schema v5 区分 `mainPassCalls / mainPassTriangles` 主 pass 口径，并发布 CSS/drawing-buffer、DPR、renderer 资源、Engine 调度、逐步 rollSafety、渲染实验/质量与 rolling shadow 计数
- [x] 1H.24 [测试] 锁定 diagnostics 字段命名与来源，避免将主 pass 数据误写成包含 shadow pass 的总 calls/triangles
- [x] 1H.25 [实现] diagnostics 使用版本化 `post-render` 快照，只在真实 render 后发布；开发/e2e 支持 nextSeed 与版本化 nextSeeds 队列，隔离 e2e 另支持一次性强制 timeout outcome
- [x] 1H.26 [测试] 锁定 schema v5 post-render revision、seed/队列消费、timeout seam、渲染实验/质量/阴影字段和 idle/settled 静态零帧语义
- [x] 1H.27 [实现/测试] 隔离 e2e 仅在 `perfProfile=1&perfProfileVersion=1` 时启用 rolling CPU profile v1；固定容量记录 rAF 原始/截断间隔、Cannon 实际 substep 与各 CPU 阶段，renderer 明确为 cpu-submit，生产和普通 e2e 零计时采样
- [x] 1H.28 [实现/测试] render experiment v1 仅允许 baseline、rolling-dpr-1x、shadow-alternate、shadow-frozen 四个版本化 e2e preset；生产忽略 URL 参数，实验 rolling-dpr-1x 仍保持无条件 1x 以复现 durable A/B
- [x] 1H.29 [实现/测试] 生产仅在基础质量 reduced 档应用 rolling 1x，full 档保持基础 DPR；该切换只改变主画布有效 DPR，不改变基础 1.0～1.5/350 万像素质量与 1024/512 阴影档，结算 raw render 前恢复 static DPR且不制造额外静态帧
- [x] 1H.30 [实现/测试] rolling shadow scheduler v1 对 every-frame/alternate/frozen-after-first 逐真实 render 计数；生产保持 every-frame，skip 不清除 resize 等外部 needsUpdate
- [x] 1H.31 [实现/测试] diagnostics schema v6 在 throw 返回后、首个物理步前捕获 initial-state v1；按 6-body canonical 顺序记录 pose/线速度/角速度，并对 Float64 大端字节生成 FNV-1a 64 签名，不消费随机数或写物理状态

### 1I 阶段一集成验证

- [x] 1I.1 [验收] 完整流程跑通：点击按钮 → 骰子投掷 → 翻滚 → 停稳 → 读数 → 判定 → 控制台输出完整 JudgeResult
- [x] 1I.2 [验收] 最终 tier-aware 策略的 schema v5 `pnpm test:e2e:soak` 桌面/移动各 20 轮 2/2 通过；桌面 77.181s、17 natural/3 stable、最长 8.346s、最大半径/穿透 0.6567970953m/0.0548978013m，移动 55.144s、20 natural、最长 3.299s、最大半径/穿透 0.6555080668m/0.0536350029m；boundary/wall/guard/non-finite/页面错误为 0，资源每轮稳定为 1/8/6/10
- [x] 1I.3 [验收] 点数读取准确（人工目视对照至少 10 轮）
- [x] 1I.4 [测试] 物理烟雾测试：真实 cannon-es 世界 + 碗 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能结算或超时
- [x] 1I.5 [验收] 奖级判定与点数组合匹配（人工核对）
- [x] 1I.6 [验收] 全部单测通过：`pnpm test`
- [x] 1I.7 [验收] `pnpm build` 通过，无编译错误
- [x] 1I.8 [验收] `pnpm test:e2e` 在桌面/移动项目完成真实固定 seed 正常结算、timeout 不提交/同轮恢复、reset、静态零帧与移动布局验收；当前 4/4 通过
- [x] 1I.9 [验收] 最终 tier-aware 策略的 schema v5 `pnpm bench:browser` 桌面/移动 2/2 通过；desktop reduced idle/settled 3,498,014px@1.445028、rolling 1,676,160px@1x，mobile full idle/rolling 562,185px@1.5x、settled 414,765px@1.5x；shadow 请求/rolling frames 为 17/17、19/19
- [x] 1I.10 [实现] `physics/roll-runner.ts` 复用正式 throw/world/escape/settle/read-face 行为链，统一单 seed 复现、批量验收与 A/B 诊断
- [x] 1I.11 [实现] variant schema v2 固定 historical、placement-control、placement-candidate、natural-control 与 current 的投掷/assist/pose 组合
- [x] 1I.12 [测试] `pnpm test:physics:ab` 落地：按 seed 交替 A/B、B/A，分离 watch/batch cohort，并对每个非自然结果运行最多 20s 的同 seed natural continuation
- [x] 1I.13 [验收] `pnpm test:acceptance` 默认 200 seeds；assist/fallback 预算均为 0，pose-stable 预算上限 2%
- [x] 1I.14 [基线] 本机 2000 固定逻辑 seed：1990 natural / 10 pose，timeout、NaN、wall、guard、assist、fallback 均为 0，p95=3.3s、p99=4.8s、max=8.2s、max penetration=0.081546；10 个非自然结果的 20s continuation 均无 face/tilt/judge/safety 差异；不作为浏览器 FPS 或跨机器结论
- [x] 1I.15 [A/B] 默认 200 seed 拆为 19 watch / 181 batch；current 的 batch fallback 与 assist 均为 0，最大穿透下降 0.016682m，p95 改善 0.1167s、p99 回退 0.25s且未越预算
- [x] 1I.16 [产品/验收] timeout 进入显式 error 与 RollErrorPanel；不读面、不判奖、不播放中奖音、不推进 round/history/prizeRecord，可同轮重新掷骰或重置
- [x] 1I.17 [实现] `test:e2e:soak`、版本化 20-seed 队列、逐步安全/状态/静态调度/WebGL 资源断言与逐轮 JSON artifact 已落地；不以命令存在替代 1I.2 的最终运行验收
- [x] 1I.18 [实现/测试] floor-relaunch tracker v1 接入统一 `runRoll()`：0.5mm 支撑容差，先满足 2 步真实 floor contact 与 6 步 clean support，再对至少 2 步的二次离地同时门禁 clearance > 5mm 和 ordered world-Y rise > 5mm；首次外部接触前满足即锁存；sampler 对单一、无 shape offset/orientation 的 Box 与 Heightfield 契约 fail closed
- [x] 1I.19 [门禁] acceptance report schema v3 / roll diagnostics schema v4 将 tracker unavailable/event 设为硬失败；A/B report schema v4 对 runtime 与 continuation 使用同一门禁
- [x] 1I.20 [基线] 当前 200 seeds / 1200 颗骰子中 initial contact observed=1190、armed=1158，secondary episode=54、floor-only=2、event=0；最大 floor-only clearance/ordered rise=2.761mm/0，最大 pre-external clearance/ordered rise=7.795mm/0；coverage 与最大值只记录不硬门禁，事件要求两项同时 >5mm；171042、25042、146042 的旧无序高度极差已确认为误报回归
- [x] 1I.21 [实现] `pnpm bench:browser:render-ab` 使用 5 个固定 seed、双方 warm-up 和逐 seed ABBA/BAAB，每个 project/comparison 共 20 measured rolls；投掷路径、稳定结果、物理安全、context/页面错误及静态零帧硬门禁，毫秒只记录；artifact 持久化至 `artifacts/render-ab/<project>-<comparison>.json`
- [x] 1I.22 [A/B] clean durable SwiftShader rolling DPR：desktop ratio=`0.7864364941630467`、5/5 改善、noise=`0.06133911408891464`、判据通过；mobile ratio=`0.6095156450921579`、5/5 改善、noise=`0.14689147459021826`、判据通过；生产仍只在 reduced 档采用 rolling 1x，full 档保持基础 DPR，static 恢复基础 DPR
- [x] 1I.23 [A/B] clean durable `shadow-upper-bound`：desktop ratio=`1.0494708050897847`、1/5 改善、noise=`0.07463589364039669`；mobile ratio=`0.8414403032217315`、4/5 改善、noise=`0.419728670053531`；两端判据均未通过，不推进 alternate，生产保持 every-frame shadow
- [x] 1I.24 [补充观察] 交互 Chrome 单 seed rolling DPR candidate 约 17.6ms、baseline 约 33ms，并核对视觉与 static DPR 恢复；不宣称通用 GPU 结论
- [x] 1I.25 [否决方案] `maxSubSteps` 8→4 裸降会在慢帧丢更多积压模拟时间，seed 25042 存在 cadence 分叉风险，不作为性能优化
- [x] 1I.26 [实验基础] `runRoll()` 改用共享 exact-step session：每个 Cannon 步后按固定顺序采样安全/contact/floor、guard、settle 与 sleep/stable 诊断，roll diagnostics 升 v3 并记录 `simulationStep / simulationTime`；seed 25042 锁定 step 460、7.6667s、骰面 `2,1,2,1,4,5`
- [x] 1I.27 [证据边界] schema v4 soak checkpoint 为 109.197s/52.950s，schema v5 为 83.527s/53.488s；只作环境观察，不把 wall-clock 差值设为性能门禁
- [x] 1I.28 [门禁结果] durable render A/B 4/4 均为 behaviorViolation=0、schedulerSensitive=0；4/4 仅表示流程/正确性硬门禁通过，不代表四组性能判据都通过
- [x] 1I.29 [验收] 最终 tier-aware 策略的 `pnpm test:e2e` 4/4、`pnpm bench:browser` 2/2 通过；确认 reduced 档 rolling=1x、full 档 rolling=base、static=base 并保留 artifact
- [x] 1I.30 [验收] 最终 tier-aware 策略的 `pnpm test:e2e:soak` 桌面/移动各 20 轮 2/2 通过；逐轮提交、物理安全、静态调度与 WebGL 资源稳定
- [x] 1I.31 [证据门禁] render A/B artifact schema v2 记录完整 HEAD、worktree dirty、porcelain 哈希和 HEAD-relative tracked diff 状态/SHA-256，并校验长跑前后 repo state 未变化；同 seed 同时硬门禁完整 initial-state v1 数组/签名。repository-state schema v2 同时哈希未跟踪普通文件内容与 symlink 目标、排除 ignored artifact；正式证据仍要求从 clean worktree 开始，dirty 运行只作探索
- [x] 1I.32 [验收] clean checkpoint `6901f4d90e7557f2bdcf2081abffb37952c2f6f5` 已完成 schema v6 / render A/B artifact schema v2 长浏览器门禁 4/4；四组均 start clean、end unchanged、behaviorViolation=0、schedulerSensitive=0。普通 `bench:browser` / soak 仍沿用此前 schema v5 checkpoint 证据，未在本次重跑
- [x] 1I.33 [实验基础] 新增未接入生产的 fixed-step accumulator v1：显式记录 accepted/paused/discarded wall time、逐步消费 backlog、cap4 跨帧追赶、插值余量与锁存 overload；单元测试锁定守恒和 early-stop，不改变当前 Engine 调度
- [x] 1I.34 [实验基础] `PhysicsWorld.stepExact()`、previous→raw 显式插值和共享 `roll-step-session` 已落地；session 具有 stepnumber delta=1 硬契约、非破坏 snapshot、可选 floor/stable 扩展与通用阶段计时接缝
- [x] 1I.35 [实验基础] versioned headless cadence runner 已覆盖 steady60/30、deterministic jitter、单次 100ms、visibility suspend 与持续 100ms；reference/cap6/cap4 复用同一 lifecycle/session，逐帧门禁时间守恒、terminal abandoned backlog 与 overload，4 个 watch seed 的正常 cadence 结果完全一致
- [x] 1I.36 [诊断] canonical body-state v1 泛化初始/终态位级签名；roll diagnostics v4 在 finish 后记录 6-body 完整终态，seed 25042 final hash=`ca710327c6d45df3`，cadence 候选显式对比 initialState、finalState 与完整 RollRunResult
- [ ] 1I.37 [后续] 增加 watch+200 batch 的 cadence comparison/CLI，再接仅 e2e 可开启的 Engine timing experiment、visibility suspend 与独立 timing-overload 错误；通过批量与浏览器门禁前不得替换生产调度

---

## 阶段二：UI 与交互（P1 — 界面完整 + 操作反馈 + 移动端可用）

### 2A React 基础接入

- [x] 2A.1 [实现] 实现 `ui/components/GameViewport.tsx`：持有 canvas 容器 ref，useEffect 中创建引擎实例和 controller 实例，cleanup 中 dispose（幂等，兼容 StrictMode 双调用）。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，确保 overlay 组件能获取 controller
- [x] 2A.2 [实现] 实现 GameControllerContext + `useGameController()` hook：controller 实例未就绪时 hook 抛出明确错误
- [x] 2A.3 [实现] 创建 `config/ui.ts`：集中定义 UI 常量（HISTORY_MAX_LENGTH = 5、INITIAL_ROUND = 1）；触摸目标尺寸单一来源于 CSS variables.css --touch-min
- [x] 2A.4 [实现] 实现 `App.tsx`：GameViewport 作为容器，overlay 组件（ThrowButton、ResultPanel 等）作为 GameViewport 的 children 渲染
- [x] 2A.5 [实现] 在 GameViewport 挂载时初始化 scene/setup、physics/world、DiceSet、game/engine、game/controller；scene 只加入 DiceSet 的 InstancedMesh，6 个 body 分别加入物理世界，并将 resize 失效回调绑定到 `engine.invalidate()`
- [x] 2A.6 [实现] GameViewport 卸载时先解绑 resize 失效回调并销毁 engine，再从 scene 移除 DiceSet、显式幂等 dispose 其共享资源，最后销毁其余 scene/renderer/物理世界与事件监听
- [x] 2A.7 [测试] StrictMode/HMR 自动化冒烟测试：重挂载不产生双实例、不残留 canvas/rAF/事件监听，每个 DiceSet create 均与一次 dispose 配对
- [x] 2A.8 [验收] 验证 Vite HMR 后 3D 场景正常重建

### 2B 核心 UI 组件

- [x] 2B.1 [实现] 实现 `ThrowButton.tsx`：掷骰按钮，通过 useGameController().throw() 调用
- [x] 2B.2 [实现] rolling 显示“骰子翻滚中”并禁用；tilt-confirm/error 也禁用普通掷骰入口，由专用面板接管
- [x] 2B.3 [实现] result phase 恢复可用
- [x] 2B.4 [实现] 实现 `ResultPanel.tsx`：当轮结果面板
- [x] 2B.5 [实现] 显示 6 颗骰子点数（数字 + 视觉排列）
- [x] 2B.6 [实现] 显示奖级名称（大号字，节庆配色）
- [x] 2B.7 [实现] 显示"带数"值（当奖级有带数时）
- [x] 2B.8 [实现] 未中奖时显示"未中奖"
- [x] 2B.9 [实现] 实现 `PrizeRecord.tsx`：累计奖级记录面板
- [x] 2B.10 [实现] 展示本局各奖级获得次数（奖池/榜单风格）
- [x] 2B.11 [实现] 实现 `History.tsx`：显示最近 HISTORY_MAX_LENGTH 轮历史（值来自 config/ui.ts）
- [x] 2B.12 [实现] 每条记录含轮次号、点数组合、奖级名称、带数
- [x] 2B.13 [实现] 实现 `SoundToggle.tsx`：音效开关按钮，通过 useGameController().toggleSound() 调用
- [x] 2B.14 [实现] 实现 `ResetButton.tsx`：重置按钮，通过 useGameController().reset() 调用；rolling 阶段禁用
- [x] 2B.15 [实现] 实现当前轮次显示
- [x] 2B.16 [实现] 所有 UI 组件只通过 selector 读取 store，写入操作通过 useGameController() 获取的 controller 实例
- [x] 2B.17 [实现] 实现 `RollErrorPanel.tsx`：明确提示 timeout 本轮未结算，隐藏正常结果/content peek，提供同轮“重新掷骰”与“重置”

### 2C 样式与主题

- [x] 2C.1 [实现] 定义 CSS Variables：主色（红）、辅色（金）、底色（米白）、文字色
- [x] 2C.2 [实现] 结果面板样式：传统节庆风格，红底金字或金边红字
- [x] 2C.3 [实现] 按钮样式：大尺寸、可触摸、有 hover/active/disabled 状态
- [x] 2C.4 [实现] 奖级记录面板样式：紧凑列表
- [x] 2C.5 [实现] 历史记录样式：滚动列表、条目区分
- [x] 2C.6 [实现] 整体布局：桌面端 canvas 居中 + 右侧/底部 UI 面板
- [x] 2C.7 [实现] 移动端布局：canvas 上半 + UI 下半，按钮足够大（≥44px touch target）
- [x] 2C.8 [实现] CSS 媒体查询断点处理（桌面/平板/手机）
- [x] 2C.9 [实现] `max-width: 768px` 关闭顶栏、倾斜/异常提示、结果面板和卡片等大面积 `backdrop-filter`，用高不透明度实色背景补偿；保留小面积图标按钮的桌面质感
- [x] 2C.10 [实现] 移动端 rolling 按钮禁用会逐帧重绘 box-shadow 的 `buttonPulse`，保留 transform/opacity ornament 动效，不全局移除阴影
- [x] 2C.11 [实现] `(update: slow)` 下复用大面积模糊回退并关闭 rolling/倾斜/error/result 动态效果；`prefers-reduced-motion: reduce` 单独关闭动画、按钮过渡和 hover 位移，不牺牲桌面静态 blur
- [x] 2C.12 [测试] CSS 契约测试锁定桌面 backdrop/rolling 规则仍存在、移动/slow 的 blur 与实色背景降级，以及 reduced-motion 的纯运动降级

### 2D 阶段二集成验证

- [x] 2D.1 [验收] 桌面端完整操作流程：掷骰 → 翻滚 → 结果展示 → 再次掷骰 → 累计记录更新
- [x] 2D.2 [验收] 移动端同上流程验证（Chrome DevTools 模拟 + 真机）
- [x] 2D.3 [验收] 重置功能验证：非 rolling 时清空记录、轮次归 1、骰子复位并保留 soundEnabled；rolling 时重置按钮处于禁用状态
- [x] 2D.4 [验收] 真实浏览器桌面/移动各连续 20 轮：状态均单次提交、历史维持最近 5 轮、静态零帧，canvas/geometry/texture/program 无逐轮增长，页面错误为 0
- [x] 2D.5 [验收] 历史记录正确显示最近 HISTORY_MAX_LENGTH 轮（默认 5）
- [x] 2D.6 [验收] 奖级记录累加正确
- [x] 2D.7 [验收] 全部单测通过：`pnpm test`
- [x] 2D.8 [验收] `pnpm build` 通过，无编译错误

---

## 阶段 1+：碰撞体倒角优化（历史实验，已由当前 Box 运行时取代）

> **归档状态**：本阶段记录曾将骰子碰撞体从 `CANNON.Box`（8v/6f 锐棱）替换为倒角凸包 `ConvexPolyhedron`（24v/14f）的实验过程。历史勾选只表示当时完成过对应实现或验证，不代表 chamfer 仍是当前运行时方案。当前物理碰撞体采用 Box；`ConvexPolyhedron` 仅保留为显式 sweep / 对照能力。

### Step 0：提取 physics-only 骰子 body 工厂

- [x] 0.1 [实现] 新建 `src/dice/dice-body.ts`，定义 `ShapeMode = 'box' | 'chamfer'` 和 `DiceBodyOptions`（halfSize?、shapeMode?、chamferRatio?），导出 `createDiceBody(opts?): CANNON.Body`，当前内部仍创建 Box shape
- [x] 0.2 [实现] 将 `FACE_NORMALS` 从 `create.ts` 迁移到 `dice-body.ts` 并重新导出；更新 `create.ts` 和 `read-face.ts` 的导入路径
- [x] 0.3 [实现] `create.ts` 中 `createDice()` 改为调用 `createDiceBody()` 获取 body，不再手写 Body 构造 + addShape
- [x] 0.4 [实现] 替换 13 个测试文件中骰子尺寸（halfSize = PHYSICS.diceHalfSize）的 `new CANNON.Body(…) + addShape(Box)` 为 `createDiceBody()`；保留 `engine-timing.test.ts` 和 `throw-invariants.test.ts` 中 0.02 尺寸的特殊夹具不动
- [x] 0.5 [测试] 全量测试通过（302 tests），无回归
- [x] 0.6 [验收] `grep "addShape.*Box" src/dice/` → 仅 `dice-body.ts` 内 box 分支（chamfer 占位为 throw Error）
- [x] 0.7 [验收] `grep "addShape.*Box" src/__tests__/` → 仅 `engine-timing.test.ts` 和 `throw-invariants.test.ts` 的 0.02 夹具

### Step 1：截角立方体凸包几何生成

- [x] 1.1 [实现] 新建 `src/dice/chamfer.ts`，导出 `createChamferedCubeHull(halfSize, chamfer): { vertices: number[][], faces: number[][] }`
- [x] 1.2 [实现] 几何定义：截角立方体（vertex truncation）— 24 顶点（每原始顶点切出 3 个新顶点）、14 面（8 三角形 + 6 八边形），满足欧拉关系 V-E+F = 24-36+14 = 2；所有面顶点逆时针 winding（从外侧看）
- [x] 1.3 [历史实现] 当时在 `config/physics.ts` 新增 `diceChamferRatio: 0.15`；当前值为 0，运行时使用 Box
- [x] 1.4 [测试] `chamfer.test.ts`：顶点数 = 24，面数 = 14
- [x] 1.5 [测试] 所有面法线朝外（面积加权法线与质心→面心向量同向）
- [x] 1.6 [测试] 包围盒 ≤ 原 Box（每轴最大坐标 ≤ halfSize）
- [x] 1.7 [测试] `chamfer=0` 退化为标准 8 顶点 / 6 面立方体
- [x] 1.8 [测试] `CANNON.ConvexPolyhedron` 能用生成数据成功构造（无抛错）

### Step 2：碰撞体替换

- [x] 2.1 [实现] `dice-body.ts` 中 `createDiceBody()` 新增 chamfer 分支：当 `shapeMode='chamfer'` 时调用 `createChamferedCubeHull()` 构建 `ConvexPolyhedron` 并 addShape
- [x] 2.2 [历史实现] 当时通过 `diceChamferRatio > 0` 将默认 shapeMode 切换为 `'chamfer'`；当前 ratio 为 0，默认使用 `'box'`
- [x] 2.3 [测试] 点数读取不受影响：复用 `read-face.test.ts` 24 个合法朝向 + 扰动样本全部通过
- [x] 2.4 [测试] 全量测试通过，无回归

### Step 3：视觉网格对齐

> 历史实验曾让视觉圆角近似物理倒角。当前视觉与物理解耦：mesh 使用 `RoundedBoxGeometry` 保留圆润外观，物理 body 使用 Box，不要求两者同构。

- [x] 3.1 [历史实现] `create.ts` 中将 `BoxGeometry` 替换为 `RoundedBoxGeometry`；当前 radius 使用独立的 `diceVisualChamferRatio`，不再与物理 `diceChamferRatio` 对齐
- [x] 3.2 [验收] 确认 RoundedBoxGeometry 原始 6 个连续面区间的方向顺序，将各面 UV 映射到单张 3×2 atlas 后合并为一个 materialIndex 0 draw group
- [x] 3.3 [验收] 目视检查：四点红面和边框在倒角处无明显畸变

### Step 4：性能基准

- [x] 4.1 [实现] 新建 `sweep/shape-bench.ts`（独立脚本，`pnpm sweep:bench` 手动执行）：Box(8v/6f) vs Chamfer(24v/14f) 各 300 帧 × 3 轮，记录 `world.step()` 中位耗时和相对倍率
- [x] 4.2 [验收] 脚本以 stdout 输出倍率，不设绝对 wall-clock 阈值
- [x] 4.3 [验收] 实测倍率 ~3.2x，在可接受范围内

### Step 4.5：试验 helper 贯通 shapeMode 参数

- [x] 4.5.1 [实现] 确保 param-sweep、jitter-diagnose 的骰子 body 创建路径支持 `shapeMode` 覆盖，Box 基线显式使用 `shapeMode: 'box'`
- [x] 4.5.2 [测试] param-sweep 和 jitter-diagnose 新增 `box baseline` 和 `chamfer baseline` 两个变体，标签准确区分
- [x] 4.5.3 [验收] review-verify timeout 阈值从 25% 收紧至 22%（实测 chamfer 约 19%）

### Step 5：tilt 回归验证

- [x] 5.1 [测试] `sweep/param-sweep.ts` 含 box/chamfer 变体对比；`sweep/damping-tune.ts` 完成 200-seed × 6 变体阻尼网格搜索
- [x] 5.2 [测试] `sweep/tilt-stats.ts` 200 轮 / 1200 骰子 tilt=0；`sweep/timeout-risk.ts` 500-seed timeout=8%
- [x] 5.3 [验收] chamfer + 阻尼 0.35/0.35: tilt 从 2→0，timeout 从 18%→8%，均优于基线
- [x] 5.4 [验收] chamferRatio=0.15 + 阻尼补偿已是最优组合，无需进一步扫参

### Step 6：收尾

- [x] 6.1 [实现] 更新 `ARCHITECTURE.md` 碰撞体方案章节，补充倒角方案描述、阻尼补偿、性能倍率
- [x] 6.2 [实现] ~~清理临时诊断测试文件~~ → 已拆分为 `sweep/` 独立脚本（param-sweep、sleep-sweep、jitter-diagnose、tilt-stats、timeout-risk、damping-tune、shape-bench）
- [x] 6.3 [验收] 全量测试通过（19 files / 295 tests）
- [x] 6.4 [验收] `pnpm build` 通过（修复未使用变量 TS 错误）
- [x] 6.5 [验收] 浏览器桌面/移动各连续 20 轮无穿模、卡死或飞出；逐步 boundary crossing / escape guard / non-finite 均为 0
- [x] 6.6 [工程] 清理全仓历史 ESLint/Prettier 债务；`pnpm lint` 从 296 项错误收敛为 0，并纳入可执行硬门禁

---

## 阶段 1++：碗底弹跳历史实验（旧 chamfer 路线，已由当前 Box 运行时取代）

> **归档状态**：本阶段针对旧 chamfer 运行时设计。当前生产运行时已选择 Box，因此以下 chamfer / restitution / Heightfield 参数实验不再是活跃实施计划；未勾选项表示历史上没有完成，不能视为已验收。PF.3 的自动事件门禁已由统一 runner 补齐，但原要求中的真实浏览器连续 20 轮目视验收仍保持开放。
>
> **历史假设**：倒角凸包在离散 Heightfield 上发生接触拓扑切换，表现为两类同源异常：
>
> - 阶段 A（动态弹跳期）：主问题骰子在动态旋转中与离散碗底发生接触拓扑切换，出现可见大幅二次弹跳
> - 阶段 B（尾段微振荡期）：接近静止后 ConvexPolyhedron 与 Heightfield 局部边缘效应导致角速度短促突增，反复打破 stable 窗口
>
> **当时的执行约束**：
>
> - 阶段 1 含 box 对照基线（用于判断修复后是否接近 box 稳定性）
> - 阶段 2 拆材质后须插入等价性回归门（参数不变，指标不漂移）
> - 阶段 4 HF 分辨率对比须同时记性能门槛
> - 阶段 5 当时仅把 chamferRatio=0 作为对照项；后续证据驱动的运行时决策已改为 Box
>
> **暂不前置**：solver iterations 增加、低速段主动衰减角速度、velocity clamp、diceDice restitution 大幅下调

### Phase 1：建立回归基线

- [x] P1.1 [实现] 新建 `sweep/bounce-baseline.ts`：固定两条回归场景（idle 初始化 + seed 1776390018022 投掷），同时跑 chamfer 和 box 对照
- [x] P1.2 [实现] idle 场景指标：主问题骰子最大二次抬升高度、首次全部 sleep 时间、是否出现 sleep 前可见二次弹跳
- [x] P1.3 [实现] seed 1776390018022 场景指标：frame 100 后主问题骰子最大 Y 回升、stable window 被打破次数、首次全部 sleep 时间、最大反弹高度、滚动总时长
- [x] P1.4 [验收] 运行输出 chamfer 和 box 两组基线数据，确认指标可解释

### Phase 2：拆碗底/碗壁材质

- [x] P2.1 [实现] `materials.ts`：`bowlMaterial` 拆为 `bowlFloorMaterial` + `bowlWallMaterial`
- [x] P2.2 [实现] `materials.ts`：`setupContactMaterials()` 新增 `diceFloor` 和 `diceWall` 两组 ContactMaterial，初始参数与原 `diceBowl` 完全一致
- [x] P2.3 [实现] `bowl-body.ts`：碗底 body 改用 `bowlFloorMaterial`，挡墙 body 改用 `bowlWallMaterial`
- [x] P2.4 [实现] `config/physics.ts`：`contact.diceBowl` 拆为 `contact.diceFloor` + `contact.diceWall`，初始值相同
- [x] P2.5 [测试] 全量测试通过，无回归
- [ ] P2.6 [历史未执行，已归档] **等价性回归门**：重跑阶段 1 基线，确认所有指标无明显漂移（拆材质本身不改变行为）

### Phase 3：碗底 restitution sweep

- [x] P3.1 [实现] 新建 `sweep/floor-restitution-sweep.ts`：仅改碗底 restitution（0.15 / 0.08 / 0.05 / 0.02），墙面保持 0.15
- [ ] P3.2 [历史未执行，已归档] 同时检验：二次弹跳是否减少、首次落碗弹性感是否过死、墙面回弹是否保持原设定
- [ ] P3.3 [历史未执行，已归档] 选定最佳碗底 restitution 值并写入 `config/physics.ts`

### Phase 4：Heightfield 分辨率对比

- [x] P4.1 [实现] 新建 `sweep/hf-resolution-sweep.ts`：对比 51 / 81 / 101 三档
- [ ] P4.2 [历史未执行，已归档] 检验：阶段 B stable broken 次数、阶段 A 最大二次抬升、性能成本（物理步进耗时、首轮总耗时）
- [ ] P4.3 [历史未执行，已归档] 选定最佳 HF_GRID_SIZE 并更新 `bowl-body.ts`

### Phase 5：chamferRatio sweep（如需）

- [x] P5.1 [实现] 新建 `sweep/chamfer-sweep.ts`：对比 0.15 / 0.12 / 0.10 / 0（box 对照，不作为候选修复）
- [ ] P5.2 [历史未执行，已归档] 确认前四阶段修复是否已足够；该计划当时仅将 chamferRatio=0 作为 Box 对照
- [ ] P5.3 [历史未执行，已归档] 如需调整 chamferRatio，更新 `config/physics.ts` 并重跑全量测试

### 收尾

- [x] PF.1 [验收] 全量测试通过（`pnpm test`）
- [x] PF.2 [验收] `pnpm build` 通过
- [x] PF.3a [自动门禁] floor-relaunch tracker v1 已接入统一 runner、acceptance 与 A/B；当前 200-seed 固定逻辑样本事件为 0，coverage 另行记录且不设比例硬门禁
- [ ] PF.3b [目视验收] 真实浏览器连续 20 轮投掷无碗底异常弹跳
- [x] PF.4 [验收] 更新 `ARCHITECTURE.md` 碗碰撞体方案章节，明确当前 Box 物理碰撞体与独立 RoundedBox 视觉几何

---

## 阶段三：氛围与表现（P2 — 中秋装饰 + 音效 + 视觉反馈）

### 3A 场景氛围

- [ ] 3A.1 [实现] 桌面材质升级：木纹纹理或程序化木纹
- [ ] 3A.2 [实现] 碗材质升级：白瓷质感（环境贴图或 MeshStandardMaterial 调参）
- [ ] 3A.3 [实现] 添加桌面装饰物：月饼低多边形模型（仅视觉，无碰撞）
- [ ] 3A.4 [实现] 添加灯笼装饰（仅视觉）
- [ ] 3A.5 [实现] 场景背景色/渐变调整为中秋暖色调
- [ ] 3A.6 [实现] 可选：后处理（暖色 color grading 或 vignette）

### 3B 音效

- [x] 3B.1 [实现] `audio/sound.ts` 管理 Web Audio 合成播放、静音与完整 dispose/remount 生命周期
- [x] 3B.2 [实现] cannon-es collide 事件按碰撞强度触发骰子碰击合成音
- [x] 3B.3 [实现] 碰撞音效具备 60ms 节流、最低冲量筛选和最多 3 个并发限制
- [x] 3B.4 [实现] 正式提交中奖结果后播放三音阶提示；倾斜待确认与 timeout 不提前播放
- [x] 3B.5 [实现] AudioContext 与 noise buffer 懒创建，不阻塞首屏；同一 context 复用 noise buffer
- [x] 3B.6 [验收] 单测覆盖静音期间不创建/恢复 context、取消静音、Promise rejection 和 dispose/remount 复位
- [ ] 3B.7 [验收] 验证高频碰撞时不产生刺耳叠音

### 3C 视觉反馈

- [ ] 3C.1 [实现] 中奖时结果面板高亮动画（CSS animation）
- [ ] 3C.2 [实现] 可选：高等级奖品（状元及以上）触发简单粒子效果
- [ ] 3C.3 [实现] 可选：骰子停稳瞬间轻微相机震动或 zoom
- [ ] 3C.4 [实现] 掷骰按钮点击时的触感反馈（移动端 vibrate API）

### 3D 骰子贴图升级（可选）

- [ ] 3D.1 [实现] 制作或获取 6 面静态贴图资源
- [ ] 3D.2 [实现] 替换 Canvas 纹理为静态贴图加载
- [ ] 3D.3 [验收] 验证贴图方向与点数映射正确

### 3E 阶段三验证

- [ ] 3E.1 [验收] 氛围场景视觉审查
- [ ] 3E.2 [验收] 音效在桌面端和移动端正常播放
- [ ] 3E.3 [验收] 装饰物不影响物理碰撞和性能
- [ ] 3E.4 [验收] 全部 P0、P1 功能无回归
- [ ] 3E.5 [验收] 全部单测通过：`pnpm test`
- [ ] 3E.6 [验收] `pnpm build` 通过，无编译错误

---

## 阶段四：多人预留（未来规划，当前不实现）

- [ ] 4.1 设计多人房间数据结构（房间 ID、玩家列表、当前轮到谁）
- [ ] 4.2 设计奖品池系统（1 状元、2 对堂、4 三红、8 四进、16 二举、32 一秀）
- [ ] 4.3 设计多人轮次推进逻辑
- [ ] 4.4 选型通信方案（WebSocket / WebRTC / 第三方 BaaS）
- [ ] 4.5 实现房间创建与加入
- [ ] 4.6 实现多人轮次同步
- [ ] 4.7 实现奖品池扣减与归属
- [ ] 4.8 多人游戏结束判定与排行
- [ ] 4.9 多人 UI：玩家列表、轮次指示、奖品池面板
