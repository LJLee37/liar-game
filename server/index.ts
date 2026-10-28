/**
 * 서버 실행 진입점: `npm start` 또는 `npm run dev:server`
 *
 * 환경 변수
 *   PORT            포트 (기본 3000)
 *   HOST            바인딩 주소 (기본 0.0.0.0 = 같은 네트워크의 다른 기기에서도 접속 가능)
 *   WORDS_DIR       단어 폴더 (기본 ./words)
 *   CLIENT_DIR      빌드된 클라이언트 폴더 (기본 ./dist/client)
 *   JUDGE_LOG_FILE  판정 기록 파일 (기본 ./data/judgements.jsonl, 빈 값이면 기록 안 함)
 *   MAX_ROOMS       최대 방 수 (기본 100)
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createGameServer } from './app.ts'
import { loadWords } from './words/load.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = process.env

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

const wordsDir = resolve(root, env.WORDS_DIR ?? 'words')
const { bank, issues } = loadWords(wordsDir)
const errors = issues.filter((i) => i.level === 'error')
for (const issue of errors) log(`단어 오류 ${issue.file}${issue.line ? `:${issue.line}` : ''} ${issue.code} ${issue.message}`)
const warnings = issues.length - errors.length
if (warnings > 0) log(`단어 경고 ${warnings}개 (자세히: npm run check:words)`)
const wordCount = bank.categories.reduce((n, c) => n + c.words.length, 0)
log(`단어 로드: 카테고리 ${bank.categories.length}개, 단어 ${wordCount}개 (${wordsDir})`)
if (bank.categories.length === 0) {
  log('출제할 수 있는 카테고리가 없어 종료합니다.')
  process.exit(1)
}

const port = Number(env.PORT ?? 3000)
const server = await createGameServer({
  port,
  host: env.HOST ?? '0.0.0.0',
  words: bank,
  clientDir: resolve(root, env.CLIENT_DIR ?? 'dist/client'),
  judgeLogFile: env.JUDGE_LOG_FILE === '' ? null : resolve(root, env.JUDGE_LOG_FILE ?? 'data/judgements.jsonl'),
  maxRooms: Number(env.MAX_ROOMS ?? 100),
  log,
})
log(`라이어 게임 서버 시작: ${server.url}`)

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  log(`${signal} 수신, 종료합니다.`)
  await server.close()
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
