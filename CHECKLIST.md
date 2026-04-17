# 博饼小游戏 - 开发 Checklist

## 阶段〇：项目初始化

- [x] 0.1 [实现] pnpm create vite（React + TypeScript 模板），生成项目骨架和 package.json
- [x] 0.2 [实现] 安装核心依赖：three、cannon-es、zustand
- [x] 0.3 [实现] 安装开发依赖：@types/three、vitest、jsdom、@testing-library/react
- [x] 0.4 [实现] 配置 ESLint + Prettier（含 React/TS 规则集）
- [x] 0.5 [实现] 配置 Vitest（vitest.config.ts，默认 environment: 'jsdom'；纯函数测试文件可用注释覆盖为 node 环境）
- [x] 0.6 [实现] 配置 tsconfig.json 路径别名（如 `@/` → `src/`）
- [x] 0.7 [实现] 创建目录结构骨架（config/、game/、scene/、physics/、dice/、rules/、ui/components/、ui/styles/、audio/、utils/、__tests__/）
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
- [x] 1B.4 [实现] 实现 canvas resize 监听：同步 renderer 尺寸、pixel ratio、camera aspect
- [x] 1B.5 [实现] 实现 `scene/table.ts`：圆桌桌面 mesh（圆柱几何体 + 木纹色基础材质）
- [x] 1B.6 [实现] 实现 `scene/bowl.ts`：海碗可视模型（Lathe 几何体或组合几何体，白瓷材质）
- [x] 1B.7 [验收] 验证页面能稳定渲染桌面 + 海碗静态场景

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

- [x] 1D.1 [实现] 实现 `utils/random.ts`：可注入随机数源接口（默认 Math.random，测试可替换为固定种子）
- [x] 1D.2 [实现] 实现 `config/throw.ts`：集中定义投掷参数（速度范围、角速度范围、初始高度范围）
- [x] 1D.3 [实现] 实现 `config/settle.ts`：集中定义停稳参数（速度阈值、角速度阈值、持续时间、超时上限）
- [x] 1D.4 [实现] 实现骰子面纹理生成器（Canvas 2D 绘制）：6 个面分别绘制 1～6 点
- [x] 1D.5 [实现] 四点面使用红色绘制，其余面使用黑色
- [x] 1D.6 [实现] 纹理生成模块预留接口：支持后续替换为静态贴图加载（参数化纹理来源）
- [x] 1D.7 [实现] 实现 `dice/create.ts`：创建单颗骰子 mesh（BoxGeometry + 6 面独立材质）
- [x] 1D.8 [实现] 创建骰子 cannon-es Body（Box shape），关联质量、阻尼参数
- [x] 1D.9 [实现] 为每颗骰子 body 设置 allowSleep=true、sleepSpeedLimit、sleepTimeLimit（参数来自 config/physics.ts）
- [x] 1D.10 [实现] 实现批量创建 6 颗骰子的工厂函数
- [x] 1D.11 [实现] 建立 mesh ↔ body 映射关系，用于渲染同步
- [x] 1D.12 [验收] 验证 6 颗骰子能在场景中正确渲染，材质和点数清晰可辨

### 1E 投掷逻辑

- [x] 1E.1 [实现] 实现 `dice/throw.ts`：为每颗骰子设置随机初始位置（碗上方散布），随机数源使用 `utils/random.ts`
- [x] 1E.2 [实现] 设置随机初始旋转（四元数随机化）
- [x] 1E.3 [实现] 设置受控随机线速度（向碗中心偏移 + 向下分量）
- [x] 1E.4 [实现] 设置受控随机角速度
- [x] 1E.5 [实现] 唤醒所有骰子 body（清除 sleep 状态）
- [x] 1E.6 [验收] 验证投掷后骰子能自然落入碗中，不飞出画面，不高速穿透

### 1F 停稳检测

- [x] 1F.1 [实现] 实现 `dice/settle.ts`：停稳检测纯函数 `checkSettled()`，接受骰子状态，返回 boolean（不自持轮询）
- [x] 1F.2 [实现] 实现 sleep 状态检测路径：全部 6 颗骰子 body 进入 sleep 则判定停稳
- [x] 1F.3 [实现] 实现速度阈值检测路径：连续满足 config/settle.ts 中定义的持续时间，所有骰子线速度和角速度均低于配置阈值
- [x] 1F.4 [实现] 实现超时兜底：超过 config/settle.ts 中定义的超时上限后，进入超时兜底结算路径（具体策略在实现时确定，不预设为"强制置零速度"）
- [x] 1F.5 [测试] 编写停稳检测单测：全部 sleep 直接结算
- [x] 1F.6 [测试] 单测：低速窗口被中断后重新计时
- [x] 1F.7 [测试] 单测：只有一颗骰子一直未停，不应提前结算
- [x] 1F.8 [测试] 单测：超时兜底触发
- [x] 1F.9 [测试] 单测：接近阈值反复抖动但不应提前结算
- [x] 1F.10 [验收] 验证全部测试通过

### 1G 点数读取

- [x] 1G.1 [实现] 定义骰子六个面的本地法线向量常量（±x, ±y, ±z 与点数 1-6 的映射）
- [x] 1G.2 [实现] 实现 `dice/read-face.ts`：将每个面法线通过骰子四元数旋转到世界坐标
- [x] 1G.3 [实现] 计算每个世界法线与 (0, 1, 0) 的点积，取最大值对应面为朝上面
- [x] 1G.4 [实现] 返回 6 颗骰子的朝上点数数组
- [x] 1G.5 [测试] 编写点数读取单测：覆盖 24 个立方体合法朝向（正对正轴的旋转）
- [x] 1G.6 [测试] 编写近边界扰动单测：在合法朝向基础上加微小随机扰动，验证仍能稳定判面
- [x] 1G.7 [验收] 验证全部测试通过

### 1H 运行时与游戏编排层

- [x] 1H.1 [实现] 实现 `game/store.ts`：Zustand store 定义（phase、round、diceValues、currentResult: JudgeResult | null、history、prizeRecord、soundEnabled、playerId）
- [x] 1H.2 [实现] store 预留 playerId 字段（默认 null，多人阶段启用）
- [x] 1H.3 [实现] store actions 为纯状态设置器：setPhase、setResult、resetState、toggleSound（无业务逻辑）
- [x] 1H.4 [实现] 实现 `game/engine.ts`：唯一 rAF 循环，每帧顺序执行 world.step → body→mesh 同步 → settle 检测 → render
- [x] 1H.5 [实现] engine 暴露 start()、stop()、dispose() 方法
- [x] 1H.6 [实现] engine 停稳检测回调：当 settle 返回 true 时通知 controller
- [x] 1H.7 [实现] 实现 `game/controller.ts`：GameController 类（唯一业务入口）
- [x] 1H.8 [实现] 实现三态状态机：idle → rolling → result，result 可直接 throw() 进入 rolling（不需回 idle）
- [x] 1H.9 [实现] controller.throw()：拒绝 rolling 阶段调用，允许 idle 和 result 阶段调用
- [x] 1H.10 [实现] controller.onSettled()：调用 read-face → judge → store.setResult()
- [x] 1H.11 [实现] controller.reset()：拒绝 rolling 阶段调用；非 rolling 时清空历史、记录、轮次，骰子回到初始位置
- [x] 1H.12 [实现] controller.toggleSound()：统一的音效开关入口
- [x] 1H.13 [测试] 编写编排层集成测试：phase 变化是否正确
- [x] 1H.14 [测试] 集成测试：rolling 中二次点击 throw() 被拒绝
- [x] 1H.15 [测试] 集成测试：result 阶段直接再次 throw() 能正常进入 rolling
- [x] 1H.16 [测试] 集成测试：结算后 history 只保留最近 HISTORY_MAX_LENGTH 轮（来自 config/ui.ts）
- [x] 1H.17 [测试] 集成测试：reset 清理当轮 + 累计记录
- [x] 1H.18 [测试] 集成测试：rolling 中调用 reset() 被拒绝
- [x] 1H.19 [测试] 集成测试：sound toggle 不影响主流程
- [x] 1H.20 [验收] 验证全部测试通过

### 1I 阶段一集成验证

- [x] 1I.1 [验收] 完整流程跑通：点击按钮 → 骰子投掷 → 翻滚 → 停稳 → 读数 → 判定 → 控制台输出完整 JudgeResult
- [ ] 1I.2 [验收] 连续 20 轮投掷无穿模、无卡死、无骰子飞出
- [x] 1I.3 [验收] 点数读取准确（人工目视对照至少 10 轮）
- [x] 1I.4 [测试] 物理烟雾测试：真实 cannon-es 世界 + 碗 + 6 骰子，固定种子跑若干帧，无 NaN、不掉出桌面、能结算或超时
- [x] 1I.5 [验收] 奖级判定与点数组合匹配（人工核对）
- [x] 1I.6 [验收] 全部单测通过：`pnpm test`
- [x] 1I.7 [验收] `pnpm build` 通过，无编译错误

---

## 阶段二：UI 与交互（P1 — 界面完整 + 操作反馈 + 移动端可用）

### 2A React 基础接入

- [x] 2A.1 [实现] 实现 `ui/components/GameViewport.tsx`：持有 canvas 容器 ref，useEffect 中创建引擎实例和 controller 实例，cleanup 中 dispose（幂等，兼容 StrictMode 双调用）。GameViewport 接受 children，内部通过 GameControllerContext.Provider 包裹 canvas + children，确保 overlay 组件能获取 controller
- [x] 2A.2 [实现] 实现 GameControllerContext + `useGameController()` hook：controller 实例未就绪时 hook 抛出明确错误
- [x] 2A.3 [实现] 创建 `config/ui.ts`：集中定义 UI 常量（HISTORY_MAX_LENGTH = 5、INITIAL_ROUND = 1）；触摸目标尺寸单一来源于 CSS variables.css --touch-min
- [x] 2A.4 [实现] 实现 `App.tsx`：GameViewport 作为容器，overlay 组件（ThrowButton、ResultPanel 等）作为 GameViewport 的 children 渲染
- [x] 2A.5 [实现] 在 GameViewport 挂载时初始化 scene/setup、physics/world、dice/create、game/engine、game/controller
- [x] 2A.6 [实现] 在 GameViewport 卸载时完整销毁：engine.dispose()、renderer.dispose()、物理世界清理、事件监听移除
- [x] 2A.7 [测试] StrictMode/HMR 自动化冒烟测试：挂载一次、卸载一次、再次挂载不产生双实例、不残留 rAF 和事件监听
- [x] 2A.8 [验收] 验证 Vite HMR 后 3D 场景正常重建

### 2B 核心 UI 组件

- [x] 2B.1 [实现] 实现 `ThrowButton.tsx`：掷骰按钮，通过 useGameController().throw() 调用
- [x] 2B.2 [实现] 掷骰中（rolling phase）显示"骰子翻滚中"并禁用
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

### 2C 样式与主题

- [x] 2C.1 [实现] 定义 CSS Variables：主色（红）、辅色（金）、底色（米白）、文字色
- [x] 2C.2 [实现] 结果面板样式：传统节庆风格，红底金字或金边红字
- [x] 2C.3 [实现] 按钮样式：大尺寸、可触摸、有 hover/active/disabled 状态
- [x] 2C.4 [实现] 奖级记录面板样式：紧凑列表
- [x] 2C.5 [实现] 历史记录样式：滚动列表、条目区分
- [x] 2C.6 [实现] 整体布局：桌面端 canvas 居中 + 右侧/底部 UI 面板
- [x] 2C.7 [实现] 移动端布局：canvas 上半 + UI 下半，按钮足够大（≥44px touch target）
- [x] 2C.8 [实现] CSS 媒体查询断点处理（桌面/平板/手机）

### 2D 阶段二集成验证

- [x] 2D.1 [验收] 桌面端完整操作流程：掷骰 → 翻滚 → 结果展示 → 再次掷骰 → 累计记录更新
- [x] 2D.2 [验收] 移动端同上流程验证（Chrome DevTools 模拟 + 真机）
- [x] 2D.3 [验收] 重置功能验证：非 rolling 时清空记录、轮次归 1、骰子复位；rolling 时重置按钮处于禁用状态
- [x] 2D.4 [验收] 连续 20 轮操作：按钮状态始终正确（掷骰中掷骰按钮和重置按钮均禁用、结束后恢复）
- [x] 2D.5 [验收] 历史记录正确显示最近 HISTORY_MAX_LENGTH 轮（默认 5）
- [x] 2D.6 [验收] 奖级记录累加正确
- [x] 2D.7 [验收] 全部单测通过：`pnpm test`
- [x] 2D.8 [验收] `pnpm build` 通过，无编译错误

---

## 阶段 1+：碰撞体倒角优化（P0 补强 — 减少棱角互锁导致的倾斜停稳）

> 目标：将骰子碰撞体从 `CANNON.Box`（8v/6f 锐棱）替换为棱倒角凸包 `ConvexPolyhedron`（24v/26f），减少骰子棱边互锁导致的 tilt。

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
- [x] 1.3 [实现] 在 `config/physics.ts` 新增 `diceChamferRatio: 0.15`（倒角比例，0=Box 回退）
- [x] 1.4 [测试] `chamfer.test.ts`：顶点数 = 24，面数 = 14
- [x] 1.5 [测试] 所有面法线朝外（面积加权法线与质心→面心向量同向）
- [x] 1.6 [测试] 包围盒 ≤ 原 Box（每轴最大坐标 ≤ halfSize）
- [x] 1.7 [测试] `chamfer=0` 退化为标准 8 顶点 / 6 面立方体
- [x] 1.8 [测试] `CANNON.ConvexPolyhedron` 能用生成数据成功构造（无抛错）

### Step 2：碰撞体替换

- [x] 2.1 [实现] `dice-body.ts` 中 `createDiceBody()` 新增 chamfer 分支：当 `shapeMode='chamfer'` 时调用 `createChamferedCubeHull()` 构建 `ConvexPolyhedron` 并 addShape
- [x] 2.2 [实现] 默认 shapeMode 改为 `'chamfer'`（`diceChamferRatio > 0` 时自动选择）
- [x] 2.3 [测试] 点数读取不受影响：复用 `read-face.test.ts` 24 个合法朝向 + 扰动样本全部通过
- [x] 2.4 [测试] 全量测试通过，无回归

### Step 3：视觉网格对齐

> 注：视觉 mesh 先接受近似对齐，不要求与物理截角凸包完全同构。RoundedBoxGeometry 是连续圆角而非截面三角形，作为第一版视觉对齐可接受，后续按需升级。

- [x] 3.1 [实现] `create.ts` 中将 `BoxGeometry` 替换为 `RoundedBoxGeometry`，radius 参数对齐 `PHYSICS.diceHalfSize * PHYSICS.diceChamferRatio`
- [x] 3.2 [验收] 确认 RoundedBoxGeometry 保留 6 个 material groups（materialIndex 0-5），现有 6 面材质映射无需改动
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
- [ ] 6.5 [验收] 连续 20 轮投掷无穿模、无卡死、无飞出

---

## 阶段 1++：碗底弹跳修复（P0 补强 — 倒角凸包与离散 Heightfield 接触拓扑切换）

> **根因**：倒角凸包在离散 Heightfield 上发生接触拓扑切换，表现为两类同源异常：
> - 阶段 A（动态弹跳期）：主问题骰子在动态旋转中与离散碗底发生接触拓扑切换，出现可见大幅二次弹跳
> - 阶段 B（尾段微振荡期）：接近静止后 ConvexPolyhedron 与 Heightfield 局部边缘效应导致角速度短促突增，反复打破 stable 窗口
>
> **执行约束**：
> - 阶段 1 含 box 对照基线（用于判断修复后是否接近 box 稳定性）
> - 阶段 2 拆材质后须插入等价性回归门（参数不变，指标不漂移）
> - 阶段 4 HF 分辨率对比须同时记性能门槛
> - 阶段 5 chamferRatio=0 仅作对照项，不作为默认候选修复
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
- [ ] P2.6 [验收] **等价性回归门**：重跑阶段 1 基线，确认所有指标无明显漂移（拆材质本身不改变行为）

### Phase 3：碗底 restitution sweep

- [x] P3.1 [实现] 新建 `sweep/floor-restitution-sweep.ts`：仅改碗底 restitution（0.15 / 0.08 / 0.05 / 0.02），墙面保持 0.15
- [ ] P3.2 [验收] 同时检验：二次弹跳是否减少、首次落碗弹性感是否过死、墙面回弹是否保持原设定
- [ ] P3.3 [验收] 选定最佳碗底 restitution 值并写入 `config/physics.ts`

### Phase 4：Heightfield 分辨率对比

- [x] P4.1 [实现] 新建 `sweep/hf-resolution-sweep.ts`：对比 51 / 81 / 101 三档
- [ ] P4.2 [验收] 检验：阶段 B stable broken 次数、阶段 A 最大二次抬升、性能成本（物理步进耗时、首轮总耗时）
- [ ] P4.3 [验收] 选定最佳 HF_GRID_SIZE 并更新 `bowl-body.ts`

### Phase 5：chamferRatio sweep（如需）

- [x] P5.1 [实现] 新建 `sweep/chamfer-sweep.ts`：对比 0.15 / 0.12 / 0.10 / 0（box 对照，不作为候选修复）
- [ ] P5.2 [验收] 确认前四阶段修复是否已足够，chamferRatio=0 仅回答"是否只能靠退回 box 解决"
- [ ] P5.3 [验收] 如需调整 chamferRatio，更新 `config/physics.ts` 并重跑全量测试

### 收尾

- [x] PF.1 [验收] 全量测试通过（`pnpm test`）
- [x] PF.2 [验收] `pnpm build` 通过
- [ ] PF.3 [验收] 连续 20 轮投掷无碗底异常弹跳
- [ ] PF.4 [验收] 更新 `ARCHITECTURE.md` 碗碰撞体方案章节

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

- [ ] 3B.1 [实现] 实现 `audio/sound.ts`：音效管理器（加载、播放、静音切换）
- [ ] 3B.2 [实现] 添加骰子碰碗碰撞音效（cannon-es collide 事件触发）
- [ ] 3B.3 [实现] 碰撞音效节流：同一帧内多次碰撞只播放一次，或按碰撞强度筛选
- [ ] 3B.4 [实现] 添加中奖提示音效
- [ ] 3B.5 [实现] 音效文件懒加载，不阻塞首屏
- [ ] 3B.6 [验收] 验证静音开关功能
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