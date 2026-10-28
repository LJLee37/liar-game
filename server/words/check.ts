/**
 * 카테고리 사이를 오가는 검사(단어 수, 소분류 크기, 카테고리 간 중복, 유사 단어).
 * 같은 카테고리 안의 중복·별칭 충돌은 파일을 읽을 때(load.ts) 이미 검사한다.
 * CLI(scripts/check-words.ts)와 서버 시작 시 같은 규칙을 쓴다.
 */
import { josa } from '../../shared/josa.ts'
import { compare } from '../judge.ts'
import type { Category, Issue } from './types.ts'

export const MIN_WORDS = 2
export const RECOMMENDED_WORDS = 10
export const DEFAULT_SIMILAR_THRESHOLD = 0.85

export interface CheckOptions {
  strict?: boolean
  similar?: number | null
}

export interface CheckResult {
  issues: Issue[]
  /** 게임에서 출제할 수 있는 카테고리 id */
  playable: Set<string>
}

export function checkCategories(categories: Category[], options: CheckOptions = {}): CheckResult {
  const issues: Issue[] = []
  const playable = new Set<string>()

  for (const cat of categories) {
    const count = cat.words.length
    if (count < MIN_WORDS) {
      issues.push({
        level: 'error',
        code: 'TOO_FEW_WORDS',
        file: cat.file,
        message: `단어가 ${count}개뿐이라 출제할 수 없어요. (최소 ${MIN_WORDS}개)`,
      })
    } else {
      playable.add(cat.id)
      if (count < RECOMMENDED_WORDS) {
        issues.push({
          level: 'warn',
          code: 'TOO_FEW_WORDS',
          file: cat.file,
          message: `단어가 ${count}개예요. ${RECOMMENDED_WORDS}개 이상을 권장해요.`,
        })
      }
    }

    const groupSizes = new Map<string, { count: number; line: number }>()
    for (const w of cat.words) {
      if (w.group === null) continue
      const g = groupSizes.get(w.group) ?? { count: 0, line: w.line }
      g.count++
      groupSizes.set(w.group, g)
    }
    for (const [group, { count: n, line }] of groupSizes) {
      if (n === 1) {
        issues.push({
          level: 'warn',
          code: 'SMALL_GROUP',
          file: cat.file,
          line,
          message: `소분류 "${group}"에 단어가 1개뿐이에요. 바보 모드에서는 카테고리 전체에서 고르게 돼요.`,
        })
      }
    }

    if (options.similar != null) issues.push(...findSimilar(cat, options.similar))
  }

  // 카테고리 간 중복: 같은 키가 여러 카테고리에 있으면 보고
  const owners = new Map<string, { cat: Category; text: string; line: number }[]>()
  for (const cat of categories) {
    const keysInCat = new Set<string>()
    for (const w of cat.words) {
      for (const k of w.keys) {
        if (keysInCat.has(k)) continue
        keysInCat.add(k)
        const list = owners.get(k) ?? []
        list.push({ cat, text: w.text, line: w.line })
        owners.set(k, list)
      }
    }
  }
  for (const list of owners.values()) {
    if (list.length < 2) continue
    const [first, ...rest] = list
    for (const other of rest) {
      issues.push({
        level: options.strict ? 'error' : 'warn',
        code: 'CROSS_CATEGORY_DUP',
        file: other.cat.file,
        line: other.line,
        message: `${josa(`"${other.text}"`, '이', '가')} ${first!.cat.file}:${first!.line} "${first!.text}"(${first!.cat.name}) 항목과 겹쳐요.`,
      })
    }
  }

  return { issues, playable }
}

/** 같은 카테고리에서 매우 비슷한 단어 쌍 (오타 의심) */
function findSimilar(cat: Category, threshold: number): Issue[] {
  const issues: Issue[] = []
  const words = cat.words
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      let best = 0
      for (const a of words[i]!.keys) for (const b of words[j]!.keys) best = Math.max(best, compare(a, b).similarity)
      if (best >= threshold) {
        issues.push({
          level: 'info',
          code: 'SIMILAR_WORDS',
          file: cat.file,
          line: words[j]!.line,
          message: `${josa(`"${words[j]!.text}"`, '과', '와')} ${words[i]!.line}줄 ${josa(`"${words[i]!.text}"`, '이', '가')} 매우 비슷해요. (유사도 ${Math.round(best * 100)}%)`,
        })
      }
    }
  }
  return issues
}
