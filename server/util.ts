import { randomBytes } from 'node:crypto'

/** 0 이상 1 미만의 난수를 돌려주는 함수. 테스트에서는 시드 고정 RNG를 넣는다. */
export type Rng = () => number

/**
 * 시드 고정 난수 생성기 (mulberry32). 같은 시드면 항상 같은 순서의 난수가 나와 테스트가 재현된다.
 * 실제 서버는 Math.random을 쓴다.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('pick: 빈 배열')
  return items[Math.floor(rng() * items.length)]!
}

/** Fisher–Yates 셔플 (원본은 그대로 두고 새 배열 반환) */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** 추측하기 어려운 무작위 문자열 (플레이어 id·재접속 토큰용) */
export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url')
}
