/**
 * 단어 목록 검사 CLI.
 *
 *   npm run check:words
 *   npm run check:words -- --strict --similar=0.85
 *   npm run check:words -- --suggest data/judgements.jsonl
 *
 * 오류가 하나라도 있으면 종료 코드 1 (CI에서 실패 처리).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { normalize } from '../server/judge.ts'
import { DEFAULT_SIMILAR_THRESHOLD } from '../server/words/check.ts'
import { loadWords } from '../server/words/load.ts'
import type { Issue, WordBank } from '../server/words/types.ts'

const HELP = `사용법: npm run check:words -- [옵션]

  --dir <폴더>          검사할 폴더 (기본: words/)
  --strict              카테고리 간 중복도 오류로 처리
  --similar[=기준]      매우 비슷한 단어 쌍 표시 (기본 기준 ${DEFAULT_SIMILAR_THRESHOLD})
  --suggest <파일>      판정 기록(JSONL)에서 별칭 후보 제안
  -h, --help            도움말`

// `--similar`만 쓰면 기본값, `--similar=0.8`이면 그 값을 쓰도록 미리 나눈다.
const argv = process.argv.slice(2).map((a) => (a === '--similar' ? `--similar=${DEFAULT_SIMILAR_THRESHOLD}` : a))
const { values } = parseArgs({
  args: argv,
  options: {
    dir: { type: 'string' },
    strict: { type: 'boolean', default: false },
    similar: { type: 'string' },
    suggest: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  console.log(HELP)
  process.exit(0)
}

const dir = values.dir ?? fileURLToPath(new URL('../words', import.meta.url))
const similar = values.similar === undefined ? null : Number(values.similar)
if (similar !== null && !(similar > 0 && similar <= 1)) {
  console.error('--similar 값은 0보다 크고 1 이하여야 해요.')
  process.exit(2)
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const LEVEL_LABEL: Record<Issue['level'], string> = {
  error: paint(31, 'ERROR'),
  warn: paint(33, 'WARN '),
  info: paint(36, 'INFO '),
}

const { bank, issues } = loadWords(dir, { strict: values.strict, similar })

issues.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
for (const issue of issues) {
  const where = `${issue.file}${issue.line ? `:${issue.line}` : ''}`
  console.log(`${where.padEnd(22)} ${LEVEL_LABEL[issue.level]}  ${issue.code.padEnd(20)} ${issue.message}`)
}
if (issues.length > 0) console.log('')

printSummary(bank)

const errors = issues.filter((i) => i.level === 'error').length
const warnings = issues.filter((i) => i.level === 'warn').length
console.log(`\n오류 ${errors}개, 경고 ${warnings}개`)

if (values.suggest) printSuggestions(values.suggest, bank)

process.exit(errors > 0 ? 1 : 0)

function printSummary(b: WordBank) {
  console.log('카테고리              파일                 단어  소분류  별칭')
  let totalWords = 0
  let totalAliases = 0
  for (const c of b.categories) {
    const groups = new Set(c.words.map((w) => w.group).filter((g) => g !== null)).size
    const aliases = c.words.reduce((n, w) => n + w.aliases.length, 0)
    totalWords += c.words.length
    totalAliases += aliases
    const label = `${c.icon ?? ''} ${c.name}`.trim()
    console.log(
      `${padVisual(label, 22)}${c.file.padEnd(20)} ${String(c.words.length).padStart(4)}  ${String(groups).padStart(6)}  ${String(aliases).padStart(4)}`,
    )
  }
  console.log(`합계: 카테고리 ${b.categories.length}개, 단어 ${totalWords}개, 별칭 ${totalAliases}개`)
}

/** 한글·이모지는 터미널에서 두 칸을 차지하므로 보이는 폭 기준으로 맞춘다. */
function padVisual(s: string, width: number): string {
  let w = 0
  for (const ch of s) w += /[ᄀ-￿]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(1, width - w))
}

interface JudgementLogEntry {
  categoryId?: string
  category: string
  word: string
  guess: string
  accepted: boolean
  method: string
}

/** 사람이 인정했지만 아직 별칭이 아닌 추측을 YAML 형식으로 보여 준다. */
function printSuggestions(file: string, b: WordBank) {
  if (!existsSync(file)) {
    console.log(`\n판정 기록 파일이 없어요: ${file}`)
    return
  }
  // 카테고리 파일 → 단어 → { 기존 별칭, 새 후보 }
  const suggestions = new Map<string, Map<string, { aliases: string[]; guesses: Set<string> }>>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let entry: JudgementLogEntry
    try {
      entry = JSON.parse(line) as JudgementLogEntry
    } catch {
      continue
    }
    if (!entry.accepted || (entry.method !== 'host' && entry.method !== 'vote')) continue
    const cat = b.categories.find((c) => c.id === entry.categoryId || c.name === entry.category)
    const word = cat?.words.find((w) => w.text === entry.word)
    if (!cat || !word) continue
    const key = normalize(entry.guess)
    if (!key || word.keys.includes(key)) continue
    const byWord = suggestions.get(cat.file) ?? new Map()
    const item = byWord.get(word.text) ?? { aliases: word.aliases, guesses: new Set<string>() }
    item.guesses.add(entry.guess.trim())
    byWord.set(word.text, item)
    suggestions.set(cat.file, byWord)
  }

  console.log('\n── 별칭 후보 (사람이 정답으로 인정한 추측) ──')
  if (suggestions.size === 0) {
    console.log('후보가 없어요.')
    return
  }
  for (const [catFile, byWord] of suggestions) {
    console.log(`\n# ${catFile}`)
    for (const [word, { aliases, guesses }] of byWord) {
      console.log(`    - ${word}: [${[...aliases, ...guesses].join(', ')}]`)
    }
  }
}
