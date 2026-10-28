/**
 * 보안 패치가 적용된 Node.js 버전에서만 서버를 실행하도록 하는 검사.
 *
 * 기준: 2026년 10월 21일 Node.js 보안 릴리스
 *   https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
 *   (TLS 호스트 검증 우회, dns.resolve NUL 바이트, Brotli 디코더 메모리 오류 등 High 등급 취약점 수정)
 *   패치 버전: v22.23.4, v24.22.1, v26.12.1. 23.x·25.x는 지원 종료(EOL)라 패치가 없다.
 *
 * 새 보안 릴리스가 나오면 아래 표와 함께 다음 두 곳도 같이 올린다.
 *   - package.json의 engines.node (테스트가 이 표와 같은지 검사한다)
 *   - Dockerfile의 NODE_VERSION
 */

export const NODE_SECURITY_ADVISORY_URL = 'https://nodejs.org/en/blog/vulnerability/october-2026-security-releases'

type Version = [major: number, minor: number, patch: number]

/** 메이저 버전별 최소 버전. `andLater`는 그 이후 메이저 버전도 허용(이미 패치를 포함하므로) */
export const SECURE_NODE_MINIMUMS: { min: Version; andLater?: boolean }[] = [
  { min: [22, 23, 4] },
  { min: [24, 22, 1] },
  { min: [26, 12, 1], andLater: true },
]

/** "v22.23.4" 또는 "22.23.4" → [22, 23, 4]. 해석할 수 없으면 null */
export function parseVersion(version: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function atLeast(v: Version, min: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== min[i]!) return v[i]! > min[i]!
  }
  return true
}

export function isSecureNodeVersion(version: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  return SECURE_NODE_MINIMUMS.some(({ min, andLater }) =>
    andLater ? v[0] >= min[0] && atLeast(v, min) : v[0] === min[0] && atLeast(v, min),
  )
}

/** package.json의 engines.node에 들어갈 범위 문자열: "^22.23.4 || ^24.22.1 || >=26.12.1" */
export function nodeEngineRange(): string {
  return SECURE_NODE_MINIMUMS.map(({ min, andLater }) => `${andLater ? '>=' : '^'}${min.join('.')}`).join(' || ')
}

/** 취약한 Node.js 버전이면 안내를 출력하고 종료한다. 서버 진입점(server/index.ts)에서 가장 먼저 호출. */
export function assertSecureNodeVersion(version: string = process.version): void {
  if (isSecureNodeVersion(version)) return
  console.error(
    [
      `현재 Node.js ${version}은(는) 보안 업데이트가 적용되지 않은 버전이라 서버를 실행하지 않습니다.`,
      `필요한 버전: ${nodeEngineRange()}`,
      `보안 공지: ${NODE_SECURITY_ADVISORY_URL}`,
      '설치: https://nodejs.org/ko/download (nvm 사용 시 예: nvm install 22 && nvm use 22)',
    ].join('\n'),
  )
  process.exit(1)
}
