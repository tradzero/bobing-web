// @vitest-environment node
/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const gameCss = readFileSync(new URL('../ui/styles/game.css', import.meta.url), 'utf8')

function findBalancedBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  expect(markerIndex, `缺少 CSS 契约标记: ${marker}`).toBeGreaterThanOrEqual(0)

  const openIndex = source.indexOf('{', markerIndex)
  expect(openIndex, `CSS 标记缺少块起点: ${marker}`).toBeGreaterThan(markerIndex)

  let depth = 0
  for (let index = openIndex; index < source.length; index++) {
    if (source[index] === '{') depth++
    if (source[index] !== '}') continue
    depth--
    if (depth === 0) return source.slice(openIndex + 1, index)
  }

  throw new Error(`CSS 标记缺少块终点: ${marker}`)
}

function expectLargeBackdropFallback(scope: string): void {
  expect(scope).toMatch(
    /\.top-bar,\s*\.tilt-warning,\s*\.roll-error,\s*\.result-panel,\s*\.panel-card\s*\{[^}]*-webkit-backdrop-filter:\s*none;[^}]*backdrop-filter:\s*none;/,
  )

  expect(scope).toMatch(/\.tilt-warning,\s*\.roll-error\s*\{[^}]*background:\s*rgba\(/)

  for (const selector of ['.top-bar', '.result-panel', '.panel-card']) {
    const escapedSelector = selector.replaceAll('.', String.raw`\.`)
    expect(scope).toMatch(new RegExp(`${escapedSelector}\\s*\\{[^}]*background:\\s*rgba\\(`))
  }
}

describe('低性能 CSS 合成契约', () => {
  it('保留桌面默认 blur、阴影与 rolling 动画', () => {
    const topBar = findBalancedBlock(gameCss, '.top-bar {')
    const iconButton = findBalancedBlock(gameCss, '.btn-icon {')
    const resultPanel = findBalancedBlock(gameCss, '.result-panel {')
    const rollingButton = findBalancedBlock(gameCss, '.btn-throw.is-rolling {')
    const buttonPulse = findBalancedBlock(gameCss, '@keyframes buttonPulse')

    expect(topBar).toContain('backdrop-filter: var(--blur-strong)')
    expect(iconButton).toContain('backdrop-filter: var(--blur-strong)')
    expect(resultPanel).toContain('box-shadow: var(--shadow-panel)')
    expect(resultPanel).toContain('backdrop-filter: var(--blur-strong)')
    expect(rollingButton).toContain('animation: buttonPulse')
    expect(buttonPulse).toContain('box-shadow:')
  })

  it('移动端关闭大面积 backdrop sampling 并禁用 box-shadow pulse', () => {
    const mobile = findBalancedBlock(gameCss, '@media (max-width: 768px)')
    expectLargeBackdropFallback(mobile)

    const rollingButton = findBalancedBlock(mobile, '.btn-throw.is-rolling {')
    const iconButton = findBalancedBlock(mobile, '.btn-icon {')
    expect(rollingButton).toContain('animation: none')
    expect(iconButton).not.toContain('backdrop-filter')
  })

  it('slow-update 环境关闭 blur 和所有 rolling 动画', () => {
    const slowUpdate = findBalancedBlock(gameCss, '@media (update: slow)')
    expectLargeBackdropFallback(slowUpdate)

    expect(slowUpdate).toMatch(
      /\.btn-throw\.is-rolling,\s*\.btn-throw\.is-rolling \.btn-throw-ornament,\s*\.tilt-warning,\s*\.roll-error,\s*\.result-panel\s*\{[^}]*animation:\s*none;/,
    )
  })

  it('reduced-motion 关闭动画、过渡与 hover 位移，但保留静态 blur 视觉', () => {
    const reduced = findBalancedBlock(gameCss, '@media (prefers-reduced-motion: reduce)')
    expect(reduced).toMatch(/\.btn\s*\{[^}]*transition:\s*none;/)
    expect(reduced).toMatch(
      /\.btn-throw\.is-rolling,\s*\.btn-throw\.is-rolling \.btn-throw-ornament,\s*\.tilt-warning,\s*\.roll-error,\s*\.result-panel\s*\{[^}]*animation:\s*none;/,
    )
    expect(reduced).toMatch(
      /\.btn-throw:not\(:disabled\):hover,\s*\.btn-icon:not\(:disabled\):hover\s*\{[^}]*transform:\s*none;/,
    )
    expect(reduced).not.toContain('backdrop-filter')
  })
})
