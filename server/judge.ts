/**
 * 라이어의 최종 추측이 정답으로 인정되는지 판정한다.
 *
 * 1. 정규화: 띄어쓰기·대소문자·문장부호·전각 문자 차이를 없앤다.
 * 2. 단어 자체나 별칭과 같으면 즉시 인정, 같은 카테고리의 다른 단어와 같으면 즉시 불인정.
 * 3. 그 외에는 한글을 자모(ㄱ, ㅏ, …) 단위로 쪼개 "편집 거리"(몇 글자를 고쳐야 같아지는지)를 계산한다.
 *    - 된소리/거센소리(ㄱ↔ㄲ↔ㅋ), ㅐ↔ㅔ처럼 헷갈리기 쉬운 차이는 비용을 낮게 매긴다.
 *    - 짧은 단어일수록 허용 비용을 줄여 "가방/가발", "배/베" 같은 다른 단어를 잘못 인정하지 않게 한다.
 *
 * 편집 거리(Levenshtein distance) 설명: https://ko.wikipedia.org/wiki/편집_거리
 * 한글 음절 분해 공식(유니코드): https://www.unicode.org/versions/latest/ch03.pdf (3.12 Conjoining Jamo Behavior)
 */
import type { JudgeReason } from '../shared/protocol.ts'
import type { Category, Word } from './words/types.ts'

// ── 정규화 ────────────────────────────────────────────────────

/** 전각 영숫자·기호(Ａ, １, ！, ＝ …)를 반각으로, 전각 공백을 일반 공백으로 바꾼다. */
export function toHalfWidth(s: string): string {
  return s.replace(/[！-～　]/g, (ch) => {
    const code = ch.charCodeAt(0)
    return code === 0x3000 ? ' ' : String.fromCharCode(code - 0xfee0)
  })
}

/**
 * 비교용 키를 만든다. NFC → 반각 → 소문자 → 글자·숫자 이외 제거.
 * NFKC를 쓰지 않는 이유: NFKC는 "ㄱㅏ"(호환 자모)를 "가"로 합쳐 버려 오타 판정을 왜곡한다.
 */
export function normalize(s: string): string {
  return toHalfWidth(s.normalize('NFC')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

// ── 자모 분해 ────────────────────────────────────────────────

const S_BASE = 0xac00
const S_COUNT = 11172
const T_COUNT = 28
const N_COUNT = 21 * T_COUNT // 588

const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ']
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ']
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']

function isSyllable(code: number): boolean {
  return code >= S_BASE && code < S_BASE + S_COUNT
}

/**
 * 문자열을 자모 토큰 배열로 쪼갠다. 예: "닭" → ['ㄷ', 'ㅏ', 'ㄺ']
 * 겹자모(ㄲ, ㅘ, ㄺ)는 하나의 토큰으로 두고, 한글 음절이 아닌 문자는 그대로 토큰이 된다.
 */
export function decompose(s: string): string[] {
  const out: string[] = []
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (!isSyllable(code)) {
      out.push(ch)
      continue
    }
    const c = code - S_BASE
    out.push(CHO[Math.floor(c / N_COUNT)]!, JUNG[Math.floor((c % N_COUNT) / T_COUNT)]!)
    const t = c % T_COUNT
    if (t !== 0) out.push(JONG[t]!)
  }
  return out
}

// ── 가중 편집 거리 ────────────────────────────────────────────

/** 서로 바꿔 써도 비용이 적은 자모 묶음과 그 비용 */
const CHEAP_GROUPS: [string[], number][] = [
  // 예사소리/된소리/거센소리 (짜장면↔자장면, 떡뽁이↔떡볶이)
  [['ㄱ', 'ㄲ', 'ㅋ'], 0.5],
  [['ㄷ', 'ㄸ', 'ㅌ'], 0.5],
  [['ㅂ', 'ㅃ', 'ㅍ'], 0.5],
  [['ㅈ', 'ㅉ', 'ㅊ'], 0.5],
  [['ㅅ', 'ㅆ'], 0.5],
  // 소리가 거의 같아진 모음 (김치찌게↔김치찌개)
  [['ㅐ', 'ㅔ'], 0.3],
  [['ㅒ', 'ㅖ'], 0.3],
  [['ㅙ', 'ㅚ', 'ㅞ'], 0.3],
]

/** 겹받침과 그 구성 자음 (닭갈비↔닥갈비) */
const COMPOUND_FINALS: Record<string, string[]> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
}

const SUBSTITUTION_COST = new Map<string, number>()
for (const [group, cost] of CHEAP_GROUPS) {
  for (const a of group) for (const b of group) if (a !== b) SUBSTITUTION_COST.set(a + b, cost)
}
for (const [compound, parts] of Object.entries(COMPOUND_FINALS)) {
  for (const p of parts) {
    SUBSTITUTION_COST.set(compound + p, 0.5)
    SUBSTITUTION_COST.set(p + compound, 0.5)
  }
}

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0
  return SUBSTITUTION_COST.get(a + b) ?? 1
}

/** 자모 토큰 배열 사이의 가중 편집 거리 (삽입·삭제 1, 치환은 위 표) */
export function weightedDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1, // 삭제
        cur[j - 1]! + 1, // 삽입
        prev[j - 1]! + substitutionCost(a[i - 1]!, b[j - 1]!), // 치환
      )
    }
    prev = cur
  }
  return prev[b.length]!
}

/** 정규화된 두 문자열의 비용과 0~1 유사도 */
export function compare(a: string, b: string): { cost: number; similarity: number } {
  const ja = decompose(a)
  const jb = decompose(b)
  const cost = weightedDistance(ja, jb)
  const maxLen = Math.max(ja.length, jb.length)
  return { cost, similarity: maxLen === 0 ? 1 : Math.max(0, 1 - cost / maxLen) }
}

/** 길이 단위: 한글 음절 1, 그 밖의 문자(영문·숫자) 0.5 */
export function lengthUnits(normalized: string): number {
  let units = 0
  for (const ch of normalized) units += isSyllable(ch.codePointAt(0)!) ? 1 : 0.5
  return units
}

/** 길이에 따라 자동 인정할 수 있는 최대 비용. 짧은 단어는 한 글자 차이도 다른 단어일 수 있다. */
export function allowedCost(units: number): number {
  if (units <= 1) return 0
  if (units <= 2) return 0.5
  if (units <= 4) return 1
  if (units <= 6) return 1.5
  return 2
}

// ── 판정 ──────────────────────────────────────────────────────

export interface JudgeResult {
  /** accept/reject: 규칙으로 확정, ask: 애매함(판정 방식에 따라 사람이 정하거나 autoVerdict 사용) */
  verdict: 'accept' | 'reject' | 'ask'
  /** 자동 판정이 제안하는 결과 */
  autoVerdict: 'accept' | 'reject'
  reason: JudgeReason
  /** 정답과의 최고 유사도 (0~1) */
  similarity: number
  /** 정답과의 최소 비용 */
  cost: number
}

/** 문장 끝 존댓말 꼬리 ("짜장면이요", "짜장면입니다")를 뗀 후보 */
const POLITE_ENDING = /(입니다|이에요|예요|이요|요|임)$/u

function guessCandidates(guess: string): string[] {
  const g = normalize(guess)
  if (!g) return []
  const stripped = g.replace(POLITE_ENDING, '')
  return stripped && stripped !== g ? [g, stripped] : [g]
}

/**
 * @param guess   라이어가 입력한 추측
 * @param answer  시민의 제시어
 * @param category 제시어가 속한 카테고리 (다른 단어와 헷갈렸는지 확인용)
 */
export function judgeGuess(guess: string, answer: Word, category: Category): JudgeResult {
  const candidates = guessCandidates(guess)
  if (candidates.length === 0) {
    return { verdict: 'reject', autoVerdict: 'reject', reason: 'empty', similarity: 0, cost: Infinity }
  }

  const answerMain = normalize(answer.text)
  for (const c of candidates) {
    if (answer.keys.includes(c)) {
      const reason = c === answerMain ? 'exact' : 'alias'
      return { verdict: 'accept', autoVerdict: 'accept', reason, similarity: 1, cost: 0 }
    }
  }

  const others = category.words.filter((w) => w !== answer)
  for (const c of candidates) {
    if (others.some((w) => w.keys.includes(c))) {
      const { cost, similarity } = bestMatch(candidates, answer.keys)
      return { verdict: 'reject', autoVerdict: 'reject', reason: 'other-word', similarity, cost }
    }
  }

  const best = bestMatch(candidates, answer.keys)
  let closestOther = Infinity
  for (const w of others) closestOther = Math.min(closestOther, bestMatch(candidates, w.keys).cost)

  const accept = best.withinBudget && best.cost < closestOther
  return {
    verdict: 'ask',
    autoVerdict: accept ? 'accept' : 'reject',
    reason: accept ? 'similar' : 'different',
    similarity: best.similarity,
    cost: best.cost,
  }
}

function bestMatch(candidates: string[], keys: string[]) {
  let cost = Infinity
  let similarity = 0
  let withinBudget = false
  for (const c of candidates) {
    for (const k of keys) {
      const r = compare(c, k)
      if (r.cost < cost) cost = r.cost
      if (r.similarity > similarity) similarity = r.similarity
      if (r.cost <= allowedCost(Math.min(lengthUnits(c), lengthUnits(k)))) withinBudget = true
    }
  }
  return { cost, similarity, withinBudget }
}

/**
 * 설명(힌트)에 자기 제시어가 그대로 들어 있는지 검사한다.
 * 한 글자 단어(예: 배)는 "배고파"처럼 흔히 쓰이므로 완전히 같을 때만 막는다.
 */
export function hintRevealsWord(hint: string, keys: string[]): boolean {
  const h = normalize(hint)
  if (!h) return false
  return keys.some((k) => h === k || ([...k].length >= 2 && h.includes(k)))
}
