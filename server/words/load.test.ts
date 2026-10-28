import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadWords, parseCategoryFile } from './load.ts'
import { checkCategories } from './check.ts'

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url))
const codes = (issues: { code: string }[]) => issues.map((i) => i.code)

describe('parseCategoryFile', () => {
  it('단어·별칭·소분류를 읽는다', () => {
    const { category, issues } = parseCategoryFile(
      'food.yaml',
      `name: 음식\nicon: 🍜\ngroups:\n  면:\n    - 짜장면: [자장면, 짜장]\n    - 짬뽕\n    - 우동: 가락국수\nwords:\n  - 비빔밥\n`,
    )
    expect(issues).toEqual([])
    expect(category).toMatchObject({ id: 'food', name: '음식', icon: '🍜' })
    expect(category!.words.map((w) => [w.text, w.group, w.aliases])).toEqual([
      ['짜장면', '면', ['자장면', '짜장']],
      ['짬뽕', '면', []],
      ['우동', '면', ['가락국수']],
      ['비빔밥', null, []],
    ])
    expect(category!.words[0]!.line).toBe(5)
  })

  it('모든 값을 문자열로 읽는다 (no, 1987, yes)', () => {
    const { category } = parseCategoryFile('x.yaml', 'name: 테스트\nwords:\n  - no\n  - 1987\n  - yes\n  - null\n')
    expect(category!.words.map((w) => w.text)).toEqual(['no', '1987', 'yes', 'null'])
  })

  it('BOM·CRLF·전각 문자·연속 공백을 처리한다', () => {
    const bytes = new TextEncoder().encode('\uFEFFname: 테스트\r\nwords:\r\n  - 아이스　 크림\r\n  - ＡＢＣ\r\n')
    const { category, issues } = parseCategoryFile('x.yaml', bytes)
    expect(issues).toEqual([])
    expect(category!.words.map((w) => w.text)).toEqual(['아이스 크림', 'ABC'])
  })

  it('UTF-8이 아니면 BAD_ENCODING', () => {
    const { category, issues } = parseCategoryFile('x.yaml', new Uint8Array([0x6e, 0x3a, 0x20, 0xc0, 0xbd]))
    expect(category).toBeNull()
    expect(codes(issues)).toEqual(['BAD_ENCODING'])
  })

  it('같은 카테고리의 중복과 별칭 충돌을 걸러 낸다', () => {
    const { category, issues } = parseCategoryFile(
      'x.yaml',
      'name: 테스트\ngroups:\n  A:\n    - 짜장면: [자장면]\n    - 짬뽕\n    - 짜장 면\n  B:\n    - 자장면\n    - 우동: 짬뽕\n    - 라면: 라면\n',
    )
    expect(codes(issues)).toEqual(['DUP_WORD', 'ALIAS_CONFLICT', 'ALIAS_CONFLICT', 'ALIAS_SAME_AS_WORD'])
    expect(category!.words.map((w) => w.text)).toEqual(['짜장면', '짬뽕', '우동', '라면'])
    expect(category!.words[2]!.aliases).toEqual([])
  })

  it('형식 오류를 보고한다', () => {
    expect(codes(parseCategoryFile('x.yaml', 'words: [a, b]').issues)).toEqual(['NO_NAME'])
    expect(codes(parseCategoryFile('x.yaml', 'name: a\nnmae: b\nwords: [a, b]').issues)).toEqual(['UNKNOWN_FIELD'])
    expect(codes(parseCategoryFile('x.yaml', 'name: a\ngroups:\n  A: [a]\n  A: [b]\n').issues)).toEqual(['DUPLICATE_KEY'])
    expect(codes(parseCategoryFile('x.yaml', 'name: a\nwords:\n  - a\n - b\n').issues)).toContain('YAML_SYNTAX')
    expect(codes(parseCategoryFile('x.yaml', 'name: a\nwords:\n  - 가: 나\n    다: 라\n').issues)).toEqual(['BAD_ENTRY'])
    expect(codes(parseCategoryFile('Bad.yaml', 'name: a\nwords: [a, b]').issues)).toEqual(['BAD_FILENAME'])
    expect(codes(parseCategoryFile('x.yaml', 'name: a\nwords:\n  - 냉면:\n  - "!!!"\n').issues)).toEqual([
      'EMPTY_ALIAS',
      'EMPTY_WORD',
    ])
  })
})

describe('checkCategories', () => {
  it('단어 수·소분류·카테고리 간 중복을 검사한다', () => {
    const a = parseCategoryFile('a.yaml', 'name: A\ngroups:\n  혼자: [배]\n').category!
    const b = parseCategoryFile('b.yaml', 'name: B\nwords: [배, 사과, 포도]\n').category!
    const result = checkCategories([a, b])
    expect(codes(result.issues).sort()).toEqual(['CROSS_CATEGORY_DUP', 'SMALL_GROUP', 'TOO_FEW_WORDS', 'TOO_FEW_WORDS'])
    expect([...result.playable]).toEqual(['b'])
    expect(checkCategories([a, b], { strict: true }).issues.find((i) => i.code === 'CROSS_CATEGORY_DUP')!.level).toBe('error')
  })

  it('--similar 기준 이상인 단어 쌍을 보고한다', () => {
    const c = parseCategoryFile('c.yaml', 'name: C\nwords: [초콜릿, 초콜렛, 사탕]\n').category!
    expect(codes(checkCategories([c], { similar: 0.85 }).issues)).toContain('SIMILAR_WORDS')
  })
})

describe('loadWords', () => {
  it('미니 픽스처를 읽는다', () => {
    const { bank, issues } = loadWords(fixture('words-mini'))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    expect(bank.categories.map((c) => c.name)).toEqual(['과일', '음식'])
  })

  it('실제 words/ 폴더에 오류가 없다', () => {
    const { bank, issues } = loadWords(fileURLToPath(new URL('../../words', import.meta.url)))
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    for (const cat of bank.categories) expect(cat.words.length, cat.name).toBeGreaterThanOrEqual(30)
  })
})

describe('check-words CLI', () => {
  const script = fileURLToPath(new URL('../../scripts/check-words.ts', import.meta.url))
  it('오류가 있으면 종료 코드 1', () => {
    const r = spawnSync(process.execPath, [script, '--dir', fixture('words-bad')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    for (const code of ['DUP_WORD', 'ALIAS_CONFLICT', 'YAML_SYNTAX', 'DUPLICATE_KEY', 'BAD_ENCODING', 'NO_NAME']) {
      expect(r.stdout).toContain(code)
    }
  })
  it('오류가 없으면 종료 코드 0', () => {
    const r = spawnSync(process.execPath, [script, '--dir', fixture('words-mini')], { encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})
