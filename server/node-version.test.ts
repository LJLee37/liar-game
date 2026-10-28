import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isSecureNodeVersion, nodeEngineRange, parseVersion } from './node-version.ts'

describe('isSecureNodeVersion (2026-10-21 보안 릴리스 기준)', () => {
  const cases: [version: string, secure: boolean][] = [
    ['v20.19.0', false],
    ['v22.18.0', false],
    ['v22.22.0', false],
    ['v22.23.3', false],
    ['v22.23.4', true],
    ['v22.24.0', true],
    ['v23.11.1', false], // EOL, 패치 없음
    ['v24.22.0', false],
    ['v24.22.1', true],
    ['v24.23.0', true],
    ['v25.9.0', false], // EOL, 패치 없음
    ['v26.12.0', false],
    ['v26.12.1', true],
    ['v27.0.0', true],
    ['22.23.4', true],
    ['garbage', false],
  ]
  for (const [version, secure] of cases) {
    it(`${version} → ${secure ? '허용' : '거부'}`, () => {
      expect(isSecureNodeVersion(version)).toBe(secure)
    })
  }

  it('버전 문자열을 해석한다', () => {
    expect(parseVersion('v22.23.4')).toEqual([22, 23, 4])
    expect(parseVersion('26.12.1-nightly')).toEqual([26, 12, 1])
    expect(parseVersion('x')).toBeNull()
  })
})

describe('package.json engines.node', () => {
  it('검사 기준 표와 같다', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      engines: { node: string }
    }
    expect(nodeEngineRange()).toBe('^22.23.4 || ^24.22.1 || >=26.12.1')
    expect(pkg.engines.node).toBe(nodeEngineRange())
  })

  it('Dockerfile의 기본 Node 버전도 보안 패치 버전 이상이다', () => {
    const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
    const m = /^ARG NODE_VERSION=(\S+)$/m.exec(dockerfile)
    expect(m, 'Dockerfile에 ARG NODE_VERSION=... 이 있어야 함').not.toBeNull()
    expect(isSecureNodeVersion(m![1]!)).toBe(true)
  })
})
