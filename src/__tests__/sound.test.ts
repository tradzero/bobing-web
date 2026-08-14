// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { soundManager } from '@/audio/sound'

interface BufferStub {
  data: Float32Array
  getChannelData: ReturnType<typeof vi.fn>
}

interface BufferSourceStub {
  buffer: AudioBuffer | null
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  onended: (() => void) | null
}

function connectingNode() {
  return {
    connect: vi.fn((destination: unknown) => destination),
  }
}

describe('soundManager 生命周期', () => {
  let contexts: AudioContextStub[]
  let now: number
  let initialContextState: AudioContextState
  let contextConstructionError: Error | null
  let createBufferError: Error | null

  class AudioContextStub {
    state: AudioContextState
    currentTime = 1
    sampleRate = 48_000
    destination = connectingNode() as unknown as AudioDestinationNode
    buffers: BufferStub[] = []
    bufferSources: BufferSourceStub[] = []
    oscillators: Array<{ connect: ReturnType<typeof vi.fn> }> = []

    constructor() {
      if (contextConstructionError) throw contextConstructionError
      this.state = initialContextState
      contexts.push(this)
    }

    resume = vi.fn(() => {
      this.state = 'running'
      return Promise.resolve()
    })

    suspend = vi.fn(() => {
      this.state = 'suspended'
      return Promise.resolve()
    })

    close = vi.fn(() => {
      this.state = 'closed'
      return Promise.resolve()
    })

    createBuffer = vi.fn((_channels: number, length: number) => {
      if (createBufferError) throw createBufferError
      const buffer: BufferStub = {
        data: new Float32Array(length),
        getChannelData: vi.fn(),
      }
      buffer.getChannelData.mockReturnValue(buffer.data)
      this.buffers.push(buffer)
      return buffer as unknown as AudioBuffer
    })

    createBufferSource = vi.fn(() => {
      const source: BufferSourceStub = {
        buffer: null,
        ...connectingNode(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      this.bufferSources.push(source)
      return source as unknown as AudioBufferSourceNode
    })

    createBiquadFilter = vi.fn(() => ({
      ...connectingNode(),
      type: 'lowpass',
      frequency: { value: 0 },
      Q: { value: 0 },
    }))

    createGain = vi.fn(() => ({
      ...connectingNode(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    }))

    createOscillator = vi.fn(() => {
      const oscillator = {
        ...connectingNode(),
        type: 'sine',
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
      }
      this.oscillators.push(oscillator)
      return oscillator as unknown as OscillatorNode
    })
  }

  beforeEach(() => {
    soundManager.dispose()
    contexts = []
    now = 100
    initialContextState = 'running'
    contextConstructionError = null
    createBufferError = null
    vi.stubGlobal('AudioContext', AudioContextStub)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    soundManager.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('静音时碰撞和中奖事件都不创建 AudioContext，取消静音也不主动创建', () => {
    soundManager.setMuted(true)

    soundManager.playCollisionSound(2)
    soundManager.playWinSound()
    soundManager.handleCollision({
      contact: { getImpactVelocityAlongNormal: () => 2 },
    })

    expect(contexts).toHaveLength(0)
    soundManager.setMuted(false)
    expect(contexts).toHaveLength(0)

    soundManager.playWinSound()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].oscillators).toHaveLength(3)
  })

  it('prepare 同步预建 context 与碰撞 buffer，重复调用保持幂等且不创建播放节点', () => {
    soundManager.prepare()

    expect(contexts).toHaveLength(1)
    expect(contexts[0].createBuffer).toHaveBeenCalledOnce()
    expect(contexts[0].bufferSources).toHaveLength(0)
    expect(contexts[0].oscillators).toHaveLength(0)

    soundManager.prepare()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].createBuffer).toHaveBeenCalledOnce()

    soundManager.playCollisionSound(2)
    expect(contexts[0].createBuffer).toHaveBeenCalledOnce()
    expect(contexts[0].bufferSources).toHaveLength(1)
  })

  it('prepare 在静音时不创建或恢复 context', () => {
    soundManager.setMuted(true)
    soundManager.prepare()
    expect(contexts).toHaveLength(0)

    soundManager.setMuted(false)
    soundManager.prepare()
    expect(contexts).toHaveLength(1)

    soundManager.setMuted(true)
    const context = contexts[0]
    expect(context.suspend).toHaveBeenCalledOnce()
    soundManager.prepare()
    expect(context.resume).not.toHaveBeenCalled()
    expect(contexts).toHaveLength(1)
  })

  it('prepare 丢弃 closed context 并为新 context 重新预建 buffer', () => {
    soundManager.prepare()
    const closedContext = contexts[0]
    closedContext.state = 'closed'

    soundManager.prepare()

    expect(contexts).toHaveLength(2)
    expect(contexts[1].createBuffer).toHaveBeenCalledOnce()
    expect(contexts[1].buffers).toHaveLength(1)
  })

  it('prepare 的 context 与 buffer 初始化异常都静默降级', () => {
    contextConstructionError = new Error('context unavailable')
    expect(() => soundManager.prepare()).not.toThrow()
    expect(contexts).toHaveLength(0)

    contextConstructionError = null
    createBufferError = new Error('buffer unavailable')
    expect(() => soundManager.prepare()).not.toThrow()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].createBuffer).toHaveBeenCalledOnce()

    createBufferError = null
    expect(() => soundManager.prepare()).not.toThrow()
    expect(contexts[0].createBuffer).toHaveBeenCalledTimes(2)
    expect(contexts[0].buffers).toHaveLength(1)
  })

  it('已创建 context 在静音期间只 suspend，不 resume 也不创建播放节点', () => {
    soundManager.playWinSound()
    const context = contexts[0]
    expect(context.oscillators).toHaveLength(3)

    soundManager.setMuted(true)
    expect(context.suspend).toHaveBeenCalledOnce()

    soundManager.playWinSound()
    soundManager.playCollisionSound(2)
    expect(context.resume).not.toHaveBeenCalled()
    expect(context.oscillators).toHaveLength(3)
    expect(context.bufferSources).toHaveLength(0)
    expect(contexts).toHaveLength(1)

    soundManager.setMuted(false)
    expect(context.resume).toHaveBeenCalledOnce()
  })

  it('suspend/resume/close 的异步拒绝与同步异常都不向外泄漏', async () => {
    soundManager.playWinSound()
    const context = contexts[0]

    context.suspend.mockImplementation(() => Promise.reject(new Error('suspend rejected')))
    expect(() => soundManager.setMuted(true)).not.toThrow()

    context.state = 'suspended'
    context.resume.mockImplementation(() => Promise.reject(new Error('resume rejected')))
    expect(() => soundManager.setMuted(false)).not.toThrow()

    context.close.mockImplementation(() => Promise.reject(new Error('close rejected')))
    expect(() => soundManager.dispose()).not.toThrow()

    // 给 catch handler 一次 microtask 机会；未处理的 rejection 会由 Vitest 使该用例失败。
    await Promise.resolve()
    await Promise.resolve()

    initialContextState = 'running'
    soundManager.playWinSound()
    const throwingContext = contexts[1]
    throwingContext.suspend.mockImplementation(() => {
      throw new Error('suspend threw')
    })
    expect(() => soundManager.setMuted(true)).not.toThrow()
    throwingContext.state = 'suspended'
    throwingContext.resume.mockImplementation(() => {
      throw new Error('resume threw')
    })
    expect(() => soundManager.setMuted(false)).not.toThrow()
    throwingContext.close.mockImplementation(() => {
      throw new Error('close threw')
    })
    expect(() => soundManager.dispose()).not.toThrow()
  })

  it('dispose 完整复位静音、节流、并发计数与 buffer，remount 可立即重新启用', () => {
    soundManager.playCollisionSound(2)
    const firstContext = contexts[0]
    const staleSource = firstContext.bufferSources[0]
    expect(firstContext.buffers).toHaveLength(1)

    soundManager.setMuted(true)
    soundManager.dispose()
    expect(soundManager.isMuted()).toBe(false)
    expect(firstContext.close).toHaveBeenCalledOnce()

    // 仅过 10ms 仍能播放，证明旧轮的 throttle 时间已清空。
    now = 110
    soundManager.playCollisionSound(2)
    const remountedContext = contexts[1]
    expect(remountedContext.bufferSources).toHaveLength(1)
    expect(remountedContext.buffers).toHaveLength(1)

    // 旧 context 的延迟 ended 不得减少新 context 的 active count。
    staleSource.onended?.()
    for (const timestamp of [180, 250, 320]) {
      now = timestamp
      soundManager.playCollisionSound(2)
    }
    expect(remountedContext.bufferSources).toHaveLength(3)
  })

  it('同一 context 内复用碰撞 noise buffer，但每次仍创建独立 source/滤波/包络', () => {
    soundManager.playCollisionSound(2)
    const context = contexts[0]
    const firstSource = context.bufferSources[0]
    firstSource.onended?.()

    now = 200
    soundManager.playCollisionSound(3)
    const secondSource = context.bufferSources[1]

    expect(context.createBuffer).toHaveBeenCalledOnce()
    expect(context.createBufferSource).toHaveBeenCalledTimes(2)
    expect(context.createBiquadFilter).toHaveBeenCalledTimes(2)
    expect(context.createGain).toHaveBeenCalledTimes(2)
    expect(firstSource.buffer).toBe(secondSource.buffer)
  })

  it('非静音且 context 处于 suspended 时，播放前安全尝试 resume', () => {
    initialContextState = 'suspended'
    soundManager.playWinSound()

    expect(contexts).toHaveLength(1)
    expect(contexts[0].resume).toHaveBeenCalledOnce()
    expect(contexts[0].oscillators).toHaveLength(3)
  })
})
