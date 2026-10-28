/**
 * words/*.yaml 파일을 읽어 카테고리 목록으로 만든다.
 *
 * - YAML 파서: https://eemeli.org/yaml/
 * - failsafe 스키마를 써서 모든 값을 문자열로 읽는다. (`no` → false, `1987` → 숫자 같은 YAML 함정 방지)
 * - 같은 카테고리 안의 중복 단어·별칭 충돌은 여기서 걸러 내고 Issue로 보고한다.
 *   오류가 난 항목만 빠지고 나머지 단어는 게임에서 그대로 쓸 수 있다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import type { Node } from 'yaml'
import { josa } from '../../shared/josa.ts'
import { normalize, toHalfWidth } from '../judge.ts'
import { checkCategories } from './check.ts'
import type { Category, Issue, Word, WordBank } from './types.ts'

const ID_PATTERN = /^[a-z0-9-]+$/
const KNOWN_FIELDS = new Set(['name', 'icon', 'description', 'groups', 'words'])
/** 경고 없이 허용하는 문자: 한글 음절, 영문, 숫자, 공백, 일부 기호 */
const ODD_CHAR = /[^가-힣a-zA-Z0-9 \-·.&'!?+:,()/]/u

/** NFC, 전각→반각, 연속 공백 정리 */
export function cleanText(s: string): string {
  return toHalfWidth(s.normalize('NFC')).replace(/\s+/g, ' ').trim()
}

export interface ParseResult {
  category: Category | null
  issues: Issue[]
}

/**
 * YAML 파일 하나를 해석한다.
 * @param file 오류 메시지에 쓸 파일 이름 (예: food.yaml)
 * @param content 파일 내용 (바이트면 UTF-8로 엄격하게 해석)
 */
export function parseCategoryFile(file: string, content: Uint8Array | string): ParseResult {
  const issues: Issue[] = []
  const report = (level: Issue['level'], code: string, message: string, line?: number) =>
    issues.push({ level, code, file, line, message })

  const id = basename(file, extname(file))
  if (!ID_PATTERN.test(id)) {
    report('error', 'BAD_FILENAME', `파일 이름은 영문 소문자·숫자·하이픈만 쓸 수 있어요: ${file}`)
    return { category: null, issues }
  }

  let text: string
  if (typeof content === 'string') {
    text = content.replace(/^﻿/, '')
  } else {
    try {
      // fatal: 잘못된 UTF-8 바이트가 있으면 예외. 맨 앞 BOM은 자동으로 제거된다.
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      report('error', 'BAD_ENCODING', 'UTF-8로 저장하세요. (CP949/EUC-KR 등은 읽을 수 없어요)')
      return { category: null, issues }
    }
  }

  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { schema: 'failsafe', uniqueKeys: true, lineCounter, prettyErrors: true })
  const lineOf = (node: Node | null | undefined): number | undefined =>
    node?.range ? lineCounter.linePos(node.range[0]).line : undefined

  if (doc.errors.length > 0) {
    for (const err of doc.errors) {
      const code = err.code === 'DUPLICATE_KEY' ? 'DUPLICATE_KEY' : 'YAML_SYNTAX'
      const message =
        code === 'DUPLICATE_KEY' ? '같은 키(소분류 이름 등)가 두 번 나와요.' : `YAML 문법 오류: ${err.message.split('\n')[0]!.replace(/ at line \d+, column \d+:?$/, '')}`
      report('error', code, message, err.linePos?.[0]?.line)
    }
    return { category: null, issues }
  }

  const root = doc.contents
  if (!isMap(root)) {
    report('error', 'BAD_ENTRY', '파일 최상위는 name, groups 등의 키로 이루어져야 해요.')
    return { category: null, issues }
  }

  let name = ''
  let icon: string | null = null
  let description: string | null = null
  const lists: { group: string | null; node: unknown; line?: number }[] = []

  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : ''
    const keyLine = lineOf(pair.key as Node)
    if (!KNOWN_FIELDS.has(key)) {
      report('error', 'UNKNOWN_FIELD', `알 수 없는 키 "${key}" (name, icon, description, groups, words만 쓸 수 있어요)`, keyLine)
      continue
    }
    if (key === 'name' || key === 'icon' || key === 'description') {
      const value = isScalar(pair.value) ? cleanText(String(pair.value.value ?? '')) : null
      if (value === null) {
        report('error', 'BAD_ENTRY', `${key}에는 문자열을 써 주세요.`, keyLine)
        continue
      }
      if (key === 'name') name = value
      else if (key === 'icon') icon = value || null
      else description = value || null
      continue
    }
    if (key === 'words') {
      lists.push({ group: null, node: pair.value, line: keyLine })
      continue
    }
    // groups
    if (!isMap(pair.value)) {
      report('error', 'BAD_ENTRY', 'groups 아래에는 "소분류 이름:" 과 단어 목록을 써 주세요.', keyLine)
      continue
    }
    for (const g of pair.value.items) {
      const groupName = isScalar(g.key) ? cleanText(String(g.key.value ?? '')) : ''
      const groupLine = lineOf(g.key as Node)
      if (!groupName) {
        report('error', 'BAD_ENTRY', '소분류 이름이 비어 있어요.', groupLine)
        continue
      }
      lists.push({ group: groupName, node: g.value, line: groupLine })
    }
  }

  if (!name) {
    report('error', 'NO_NAME', '카테고리 이름(name)이 필요해요.')
    return { category: null, issues }
  }

  const words: Word[] = []
  /** 정규화 키 → 그 키를 가진 단어 (중복·충돌 검사용) */
  const seen = new Map<string, { word: Word; isAlias: boolean }>()

  for (const list of lists) {
    const where = list.group ? `소분류 "${list.group}"` : 'words'
    if (!isSeq(list.node)) {
      report('error', 'BAD_ENTRY', `${where}의 값은 "- 단어" 형식의 목록이어야 해요.`, list.line)
      continue
    }
    for (const item of list.node.items) {
      const line = lineOf(item as Node) ?? list.line ?? 0
      const entry = readEntry(item)
      if ('error' in entry) {
        report('error', 'BAD_ENTRY', entry.error, line)
        continue
      }
      const text = cleanText(entry.word)
      const mainKey = normalize(text)
      if (!mainKey) {
        report('error', 'EMPTY_WORD', '빈 단어예요.', line)
        continue
      }
      if (ODD_CHAR.test(text)) report('warn', 'ODD_CHARS', `"${text}"에 특이한 문자가 있어요.`, line)

      const prev = seen.get(mainKey)
      if (prev) {
        if (prev.isAlias) {
          report('error', 'ALIAS_CONFLICT', `${josa(`"${text}"`, '이', '가')} ${prev.word.line}줄 "${prev.word.text}"의 별칭과 같아요.`, line)
        } else {
          report('error', 'DUP_WORD', `${josa(`"${text}"`, '이', '가')} ${prev.word.line}줄 ${josa(`"${prev.word.text}"`, '과', '와')} 중복이에요.`, line)
        }
        continue
      }

      const word: Word = { text, aliases: [], group: list.group, line, keys: [mainKey] }
      for (const rawAlias of entry.aliases) {
        const alias = cleanText(rawAlias)
        const aliasKey = normalize(alias)
        if (!aliasKey) {
          report('warn', 'EMPTY_ALIAS', `"${text}"의 별칭이 비어 있어요.`, line)
          continue
        }
        if (aliasKey === mainKey) {
          report('warn', 'ALIAS_SAME_AS_WORD', `"${text}"의 별칭 ${josa(`"${alias}"`, '은', '는')} 띄어쓰기 등만 달라 필요 없어요.`, line)
          continue
        }
        if (word.keys.includes(aliasKey)) continue // 같은 단어 안에서 반복된 별칭
        const other = seen.get(aliasKey)
        if (other) {
          report(
            'error',
            'ALIAS_CONFLICT',
            `"${text}"의 별칭 ${josa(`"${alias}"`, '이', '가')} ${other.word.line}줄 ${other.isAlias ? `"${other.word.text}"의 별칭과` : josa(`"${other.word.text}"`, '과', '와')} 같아요.`,
            line,
          )
          continue
        }
        if (ODD_CHAR.test(alias)) report('warn', 'ODD_CHARS', `별칭 "${alias}"에 특이한 문자가 있어요.`, line)
        word.aliases.push(alias)
        word.keys.push(aliasKey)
      }
      if (entry.emptyAlias) report('warn', 'EMPTY_ALIAS', `"${text}:" 뒤에 별칭이 없어요.`, line)

      seen.set(mainKey, { word, isAlias: false })
      for (const k of word.keys.slice(1)) seen.set(k, { word, isAlias: true })
      words.push(word)
    }
  }

  return { category: { id, file, name, icon, description, words }, issues }
}

type Entry = { word: string; aliases: string[]; emptyAlias: boolean } | { error: string }

/** 목록 항목 하나: "- 단어" 또는 "- 단어: 별칭" 또는 "- 단어: [별칭1, 별칭2]" */
function readEntry(item: unknown): Entry {
  if (isScalar(item)) return { word: String(item.value ?? ''), aliases: [], emptyAlias: false }
  if (isMap(item)) {
    if (item.items.length !== 1) {
      return { error: '한 줄에 단어 하나만 쓰세요. ("- 단어: [별칭]" 형식인지, 들여쓰기가 맞는지 확인)' }
    }
    const pair = item.items[0]!
    if (!isScalar(pair.key)) return { error: '단어는 문자열이어야 해요.' }
    const word = String(pair.key.value ?? '')
    const v = pair.value
    if (v === null || v === undefined) return { word, aliases: [], emptyAlias: true }
    if (isScalar(v)) {
      const alias = String(v.value ?? '')
      return { word, aliases: alias ? [alias] : [], emptyAlias: !alias }
    }
    if (isSeq(v)) {
      const aliases: string[] = []
      for (const a of v.items) {
        if (!isScalar(a)) return { error: `"${word}"의 별칭 목록에는 문자열만 쓸 수 있어요.` }
        aliases.push(String(a.value ?? ''))
      }
      return { word, aliases, emptyAlias: aliases.length === 0 }
    }
    return { error: `"${word}"의 별칭은 문자열이나 [목록]으로 써 주세요.` }
  }
  return { error: '단어는 "- 단어" 형식으로 써 주세요.' }
}

export interface LoadOptions {
  /** 카테고리 간 중복을 오류로 처리 */
  strict?: boolean
  /** 유사 단어 보고 기준 (0~1). 없으면 검사하지 않음 */
  similar?: number | null
}

export interface LoadResult {
  bank: WordBank
  issues: Issue[]
}

/** 폴더의 모든 카테고리 파일을 읽고 검사한다. 게임에 쓸 수 없는 카테고리(단어 2개 미만 등)는 bank에서 빠진다. */
export function loadWords(dir: string, options: LoadOptions = {}): LoadResult {
  const issues: Issue[] = []
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith('_'))
    .sort()

  const parsed: Category[] = []
  const byName = new Map<string, Category>()
  const byId = new Map<string, Category>()
  for (const file of files) {
    const result = parseCategoryFile(file, readFileSync(join(dir, file)))
    issues.push(...result.issues)
    const cat = result.category
    if (!cat) continue
    const sameName = byName.get(cat.name)
    if (sameName) {
      issues.push({
        level: 'error',
        code: 'DUP_CATEGORY_NAME',
        file,
        message: `카테고리 이름 ${josa(`"${cat.name}"`, '이', '가')} ${josa(sameName.file, '과', '와')} 같아요.`,
      })
      continue
    }
    if (byId.has(cat.id)) {
      issues.push({ level: 'error', code: 'BAD_FILENAME', file, message: `id "${cat.id}"인 파일이 이미 있어요.` })
      continue
    }
    byName.set(cat.name, cat)
    byId.set(cat.id, cat)
    parsed.push(cat)
  }

  const checked = checkCategories(parsed, options)
  issues.push(...checked.issues)

  const categories = parsed
    .filter((c) => checked.playable.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return { bank: { categories, byId: new Map(categories.map((c) => [c.id, c])) }, issues }
}
