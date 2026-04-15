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

/** 确保 AudioContext 存在且恢复 */
function ensureCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext()
    } catch {
      return null
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

/**
 * 播放碰撞短音效
 * 合成一个极短的撞击声：白噪声 burst + 低频衰减
 * @param impulse 碰撞冲量，用于控制音量
 */
function playCollisionSound(impulse: number): void {
  const ctx = ensureCtx()
  if (!ctx || muted) return

  const now = performance.now()
  if (now - lastCollisionTime < COLLISION_THROTTLE) return
  if (activeCollisionCount >= MAX_CONCURRENT_COLLISION) return
  lastCollisionTime = now
  activeCollisionCount++

  // 音量映射：冲量越大越响，上限 0.35
  const volume = Math.min(0.35, impulse * 0.08)
  const t = ctx.currentTime

  // 白噪声 buffer（极短 burst，模拟瓷器/骨质碰撞）
  const duration = 0.04
  const sampleRate = ctx.sampleRate
  const bufferSize = Math.floor(sampleRate * duration)
  const buffer = ctx.createBuffer(1, bufferSize, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) // 线性衰减噪声
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer

  // 带通滤波：保留中高频碰击感
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 3000
  filter.Q.value = 1.2

  // 音量包络
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(volume, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)

  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start(t)
  source.stop(t + 0.07)
  source.onended = () => { activeCollisionCount-- }
}

/**
 * 播放中奖提示音
 * Web Audio 合成：宫商角风格三音阶短促上行
 */
function playWinSound(): void {
  const ctx = ensureCtx()
  if (!ctx || muted) return

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
  if (audioCtx) {
    if (muted) {
      audioCtx.suspend()
    } else {
      audioCtx.resume()
    }
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
  if (audioCtx) {
    audioCtx.close()
    audioCtx = null
  }
}

export const soundManager = {
  playCollisionSound,
  playWinSound,
  handleCollision,
  setMuted,
  isMuted,
  dispose,
}
