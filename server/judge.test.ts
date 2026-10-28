import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { allowedCost, compare, decompose, hintRevealsWord, judgeGuess, lengthUnits, normalize } from './judge.ts'
import { loadWords } from './words/load.ts'
import type { Category, Word } from './words/types.ts'

function word(text: string, aliases: string[] = []): Word {
  const keys = [...new Set([text, ...aliases].map(normalize))]
  return { text, aliases, group: null, line: 0, keys }
}

function category(...words: Word[]): Category {
  return { id: 't', file: 't.yaml', name: '테스트', icon: null, description: null, words }
}

describe('normalize', () => {
  it('공백·대소문자·문장부호·전각 문자를 없앤다', () => {
    expect(normalize(' ｐｉｚｚａ! ')).toBe('pizza')
    expect(normalize('아이스 크림')).toBe('아이스크림')
    expect(normalize('N서울 타워')).toBe('n서울타워')
    expect(normalize('C.S.I')).toBe('csi')
  })

  it('호환 자모를 음절로 합치지 않는다 (NFKC 미사용)', () => {
    expect(normalize('ㄱㅏ')).toBe('ㄱㅏ')
  })
})

describe('decompose', () => {
  it('음절을 초성·중성·종성으로 나눈다', () => {
    expect(decompose('닭')).toEqual(['ㄷ', 'ㅏ', 'ㄺ'])
    expect(decompose('가')).toEqual(['ㄱ', 'ㅏ'])
    expect(decompose('tv1')).toEqual(['t', 'v', '1'])
  })

  it('미완성 입력(호환 자모)도 같은 토큰이 된다', () => {
    expect(compare('짜장며ㄴ', '짜장면').cost).toBe(0)
  })
})

describe('allowedCost / lengthUnits', () => {
  it('짧을수록 허용 비용이 작다', () => {
    expect(lengthUnits('배')).toBe(1)
    expect(lengthUnits('tv')).toBe(1)
    expect(allowedCost(1)).toBe(0)
    expect(allowedCost(2)).toBe(0.5)
    expect(allowedCost(3)).toBe(1)
    expect(allowedCost(6)).toBe(1.5)
    expect(allowedCost(9)).toBe(2)
  })
})

describe('judgeGuess', () => {
  const cases: [guess: string, answer: string, verdict: string, autoVerdict: string][] = [
    // 오타·표기 차이 → 자동 인정 제안
    ['자장면', '짜장면', 'ask', 'accept'],
    ['초콜렛', '초콜릿', 'ask', 'accept'],
    ['떡뽁이', '떡볶이', 'ask', 'accept'],
    ['김치찌게', '김치찌개', 'ask', 'accept'],
    ['텔레비젼', '텔레비전', 'ask', 'accept'],
    ['닥갈비', '닭갈비', 'ask', 'accept'],
    // 다른 단어 → 자동 불인정 제안
    ['가발', '가방', 'ask', 'reject'],
    ['베', '배', 'ask', 'reject'],
    ['발', '말', 'ask', 'reject'],
    ['휴대폰', '핸드폰', 'ask', 'reject'],
    ['로보트', '로봇', 'ask', 'reject'],
    ['오스트리아', '오스트레일리아', 'ask', 'reject'],
    // 정확히 일치 (띄어쓰기·꼬리 무시)
    ['아이스 크림', '아이스크림', 'accept', 'accept'],
    ['짜장면이요', '짜장면', 'accept', 'accept'],
    ['짜장면입니다', '짜장면', 'accept', 'accept'],
    ['요요', '요요', 'accept', 'accept'],
    ['', '짜장면', 'reject', 'reject'],
    ['!!!', '짜장면', 'reject', 'reject'],
  ]
  for (const [guess, answer, verdict, autoVerdict] of cases) {
    it(`${guess || '(빈 값)'} → ${answer}: ${verdict}/${autoVerdict}`, () => {
      const a = word(answer)
      const r = judgeGuess(guess, a, category(a, word('무관한단어')))
      expect(r.verdict).toBe(verdict)
      expect(r.autoVerdict).toBe(autoVerdict)
    })
  }

  it('별칭과 일치하면 alias로 인정', () => {
    const a = word('스마트폰', ['핸드폰', '휴대폰'])
    const r = judgeGuess('휴대 폰', a, category(a))
    expect(r).toMatchObject({ verdict: 'accept', reason: 'alias' })
  })

  it('같은 카테고리의 다른 단어를 말하면 즉시 불인정 (바보 모드에서 자기 단어 입력)', () => {
    const a = word('짜장면', ['자장면'])
    const b = word('짬뽕')
    const r = judgeGuess('짬뽕', a, category(a, b))
    expect(r).toMatchObject({ verdict: 'reject', reason: 'other-word' })
  })

  it('정답보다 다른 단어에 더 가까우면 자동 인정하지 않는다', () => {
    const a = word('가방')
    const b = word('가발')
    const r = judgeGuess('까발', a, category(a, b))
    expect(r.autoVerdict).toBe('reject')
  })

  it('유사도 값을 0~1로 돌려준다', () => {
    const a = word('초콜릿')
    const r = judgeGuess('초콜렛', a, category(a))
    expect(r.similarity).toBeGreaterThan(0.8)
    expect(r.similarity).toBeLessThan(1)
  })
})

describe('hintRevealsWord', () => {
  it('제시어(또는 별칭)를 포함하면 true', () => {
    expect(hintRevealsWord('맛있는 짜장면', ['짜장면'])).toBe(true)
    expect(hintRevealsWord('자 장 면 먹고 싶다', ['짜장면', '자장면'])).toBe(true)
    expect(hintRevealsWord('검은 소스 면', ['짜장면'])).toBe(false)
  })

  it('한 글자 단어는 완전히 같을 때만 막는다', () => {
    expect(hintRevealsWord('배고파', ['배'])).toBe(false)
    expect(hintRevealsWord('배!', ['배'])).toBe(true)
  })
})

describe('실제 단어 목록 전수 검사', () => {
  const dir = fileURLToPath(new URL('../words', import.meta.url))
  const { bank } = loadWords(dir)

  it('모든 단어와 별칭은 자기 자신으로 인정된다', () => {
    for (const cat of bank.categories) {
      for (const w of cat.words) {
        expect(judgeGuess(w.text, w, cat).verdict, `${cat.name}/${w.text}`).toBe('accept')
        for (const alias of w.aliases) {
          expect(judgeGuess(alias, w, cat).verdict, `${cat.name}/${w.text}/${alias}`).toBe('accept')
        }
      }
    }
  })

  it('같은 카테고리의 다른 단어는 절대 정답으로 인정되지 않는다', () => {
    for (const cat of bank.categories) {
      for (const answer of cat.words) {
        for (const other of cat.words) {
          if (other === answer) continue
          const r = judgeGuess(other.text, answer, cat)
          expect(r.verdict === 'accept' || r.autoVerdict === 'accept', `${cat.name}: ${other.text} → ${answer.text}`).toBe(false)
        }
      }
    }
  })
})
