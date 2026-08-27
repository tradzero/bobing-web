/**
 * 音效管理器
 * - 碰撞音效：cannon-es collide 事件触发，按碰撞强度筛选 + 节流
 * - 中奖提示音：Web Audio 合成短促宫商角风格三音阶
 * - 静音开关：全局暂停/恢复 AudioContext
 * - 懒加载：首次交互后初始化 AudioContext
 */

/** 碰撞音效节流间隔 (ms) */
const COLLISION_THROTTLE = 60
/** 碰撞触发最低冲量阈值 */
const COLLISION_MIN_IMPULSE = 0.5
/** 碰撞音效最大同时播放数 */
const MAX_CONCURRENT_COLLISION = 3

let audioCtx: AudioContext | null = null
let muted = false
let lastCollisionTime = 0
let activeCollisionCount = 0
let collisionNoiseBuffer: AudioBuffer | null = null

/**
 * Web Audio 的生命周期方法返回 Promise，且在自动播放策略、重复关闭等情况下可能拒绝。
 * 音效是可选反馈，这些拒绝不应变成页面的 unhandled rejection。
 */
function safelyRunContextOperation(operation: () => Promise<unknown>): void {
  try {
    void Promise.resolve(operation()).catch(() => undefined)
  } catch {
    // 某些 mock / 浏览器实现也可能同步抛错；保持音效降级为静默。
  }
}

function clearClosedContext(): void {
  if (audioCtx?.state !== 'closed') return
  audioCtx = null
  collisionNoiseBuffer = null
  activeCollisionCount = 0
  lastCollisionTime = 0
}

/** 确保 AudioContext 存在且恢复 */
function ensureCtx(): AudioContext | null {
  // 静音期间不得因碰撞/中奖事件创建或恢复音频上下文。
  if (muted) return null

  clearClosedContext()
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext()
    } catch {
      return null
    }
  }
  if (audioCtx.state === 'suspended') {
    safelyRunContextOperation(() => audioCtx!.resume())
  }
  return audioCtx
}

/** 每个 AudioContext 只生成一次极短白噪声 burst；各次播放仍独立建立滤波与音量包络。 */
function getCollisionNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (collisionNoiseBuffer) return collisionNoiseBuffer

  const duration = 0.04
  const bufferSize = Math.floor(ctx.sampleRate * duration)
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) // 线性衰减噪声
  }
  collisionNoiseBuffer = buffer
  return buffer
}

/**
 * 在投掷按钮的用户手势栈内预热碰撞音频。
 *
 * AudioContext 与白噪声 buffer 都会在首个物理步之前同步创建，避免第一次碰撞回调
 * 把初始化成本计入 world.step。音效属于可选反馈，初始化失败时保持静默降级。
 */
function prepare(): void {
  if (muted) return

  try {
    const ctx = ensureCtx()
    if (!ctx) return
    getCollisionNoiseBuffer(ctx)
  } catch {
    // Web Audio 不可用或 buffer 创建失败时不影响投掷主流程；后续播放仍可按原路径重试。
    collisionNoiseBuffer = null
  }
}

/**
 * 播放碰撞短音效
 * 合成一个极短的撞击声：白噪声 burst + 低频衰减
 * @param impulse 碰撞冲量，用于控制音量
 */
function playCollisionSound(impulse: number): void {
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return

  const now = performance.now()
  if (now - lastCollisionTime < COLLISION_THROTTLE) return
  if (activeCollisionCount >= MAX_CONCURRENT_COLLISION) return
  lastCollisionTime = now
  activeCollisionCount++

  // 音量映射：冲量越大越响，上限 0.35
  const volume = Math.min(0.35, impulse * 0.08)
  const t = ctx.currentTime

  const source = ctx.createBufferSource()
  source.buffer = getCollisionNoiseBuffer(ctx)

  // 带通滤波：保留中高频碰击感
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 3000
  filter.Q.value = 1.2

  // 音量包络
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)

  source.onended = () => {
    // dispose 后旧 source 可能才收到 ended，不得污染新一轮 context 的并发计数。
    if (audioCtx === ctx) activeCollisionCount = Math.max(0, activeCollisionCount - 1)
  }
  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start(t)
  source.stop(t + 0.07)
}

/**
 * 播放中奖提示音
 * Web Audio 合成：宫商角风格三音阶短促上行
 */
function playWinSound(): void {
  if (muted) return
  const ctx = ensureCtx()
  if (!ctx) return

  const t = ctx.currentTime
  // 宫商角：C5 → D5 → E5（523, 587, 659 Hz）
  const notes = [523, 587, 659]
  const noteGap = 0.09
  const noteDuration = 0.12

  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle' // 木琴/钟罄质感
    osc.frequency.value = notes[i]

    const gain = ctx.createGain()
    const start = t + i * noteGap
    gain.gain.setValueAtTime(0.18, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration)

    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + noteDuration + 0.01)
  }
}

/**
 * 设置静音状态
 */
function setMuted(value: boolean): void {
  muted = value
  clearClosedContext()
  if (!audioCtx) return

  if (muted && audioCtx.state === 'running') {
    safelyRunContextOperation(() => audioCtx!.suspend())
  } else if (!muted && audioCtx.state === 'suspended') {
    safelyRunContextOperation(() => audioCtx!.resume())
  }
}

function isMuted(): boolean {
  return muted
}

/**
 * cannon-es collide 事件处理器
 * 在 engine 中绑定到骰子 body 的 'collide' 事件
 */
function handleCollision(event: { contact: { getImpactVelocityAlongNormal: () => number } }): void {
  const impulse = Math.abs(event.contact.getImpactVelocityAlongNormal())
  if (impulse >= COLLISION_MIN_IMPULSE) {
    playCollisionSound(impulse)
  }
}

/** 释放 AudioContext */
function dispose(): void {
  const contextToClose = audioCtx

  // 先切断所有旧 source 回调与单例状态的关联，再异步关闭 context。
  audioCtx = null
  collisionNoiseBuffer = null
  muted = false
  lastCollisionTime = 0
  activeCollisionCount = 0

  if (contextToClose && contextToClose.state !== 'closed') {
    safelyRunContextOperation(() => contextToClose.close())
  }
}

export const soundManager = {
  prepare,
  playCollisionSound,
  playWinSound,
  handleCollision,
  setMuted,
  isMuted,
  dispose,
}
