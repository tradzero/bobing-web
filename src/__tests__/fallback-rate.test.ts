/**
 * 验证 fallback 触发率
 */
import { describe, it, expect } from 'vitest'
import { reseed, random } from '@/utils/random'
import { THROW } from '@/config/throw'

describe('fallback 触发率', () => {
  it('1000 次投掷中 fallback 比例', () => {
    const { spreadRadius, minSeparation, maxPlacementAttempts } = THROW
    const minSepSq = minSeparation * minSeparation
    const COUNT = 6
    const TRIALS = 1000
    let fallbackCount = 0

    for (let trial = 0; trial < TRIALS; trial++) {
      reseed(trial * 1000)

      const placed: Array<{ x: number; z: number }> = []
      let useFallback = false

      for (let i = 0; i < COUNT; i++) {
        let accepted = false
        for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
          const angle = random() * Math.PI * 2
          const r = random() * spreadRadius
          const cx = Math.cos(angle) * r
          const cz = Math.sin(angle) * r

          let tooClose = false
          for (const p of placed) {
            const dx = cx - p.x
            const dz = cz - p.z
            if (dx * dx + dz * dz < minSepSq) {
              tooClose = true
              break
            }
          }
          if (!tooClose) {
            placed.push({ x: cx, z: cz })
            accepted = true
            break
          }
        }
        if (!accepted) {
          useFallback = true
          break
        }
      }

      if (useFallback) fallbackCount++
    }

    const rate = fallbackCount / TRIALS * 100
    console.log(`\nFallback 触发率: ${fallbackCount}/${TRIALS} = ${rate.toFixed(1)}%`)
    console.log(`minSeparation: ${minSeparation.toFixed(4)}`)
    console.log(`spreadRadius: ${spreadRadius}`)
    console.log(`面积占用比: ${(6 * Math.PI * (minSeparation/2)**2 / (Math.PI * spreadRadius**2) * 100).toFixed(1)}%`)

    // 不做断言，只收集数据
    expect(true).toBe(true)
  })
})
