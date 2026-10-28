/**
 * 브라우저 스모크 테스트 (수동 실행용, CI에서는 돌리지 않음)
 *
 *   npm run build && npm run smoke
 *
 * Playwright(https://playwright.dev)로 브라우저 4개(그중 1개는 iPhone 화면)를 띄워
 * 로비 → 방 만들기 → 입장 → 한 라운드 진행 → 결과까지 실제로 클릭해 보고,
 * 단계별 스크린샷을 smoke-output/ 에 저장한다. 브라우저 콘솔 오류가 있으면 실패.
 *
 * Playwright가 설치되어 있어야 한다: npm i -D playwright && npx playwright install chromium
 * (선택 도구라 의존성과 타입 검사(tsconfig.server.json exclude)에서 뺐다)
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { createGameServer } from '../server/app.ts'
import { loadWords } from '../server/words/load.ts'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright') as typeof import('playwright')

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = `${root}smoke-output`
mkdirSync(outDir, { recursive: true })

const { bank } = loadWords(`${root}words`)
const server = await createGameServer({ port: 0, host: '127.0.0.1', words: bank, clientDir: `${root}dist/client` })
const url = server.url
console.log(`서버: ${url}`)

const errors: string[] = []
let browser: Browser | null = null

async function newPlayer(name: string, device?: (typeof devices)[string]): Promise<Page> {
  const context = await browser!.newContext(device ?? { viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`)
  })
  return page
}

async function shot(pages: Page[], step: string) {
  await Promise.all(pages.map((p, i) => p.screenshot({ path: `${outDir}/${step}-p${i}.png`, fullPage: true })))
  console.log(`스크린샷: ${step}`)
}

async function waitText(page: Page, text: string | RegExp, timeout = 10_000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout })
}

try {
  browser = await chromium.launch()
  const names = ['방장', '철수', '영희', '민수']
  const pages = [
    await newPlayer(names[0]!),
    await newPlayer(names[1]!),
    await newPlayer(names[2]!),
    await newPlayer(names[3]!, devices['iPhone 13']),
  ]
  const [host] = pages as [Page, ...Page[]]

  // 1. 방장: 로비 → 방 만들기
  await host.goto(url)
  await host.getByPlaceholder('친구들에게 보일 이름').fill(names[0]!)
  await host.getByRole('button', { name: '방 만들기' }).click()
  await host.getByRole('button', { name: '만들기', exact: true }).click()
  await host.waitForURL(/\/room\/[A-Z0-9]{4}$/)
  const code = host.url().split('/').at(-1)!
  console.log(`방 코드: ${code}`)

  // 2. 나머지: 로비 목록에서 방을 눌러 입장 (마지막 사람은 초대 링크로 바로 입장)
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i]!
    if (i === pages.length - 1) {
      await p.goto(`${url}/room/${code}`)
      await p.getByLabel('닉네임').fill(names[i]!)
      await p.getByRole('button', { name: '입장', exact: true }).click()
      await waitText(p, '게임 설정')
      continue
    }
    await p.goto(url)
    await p.getByPlaceholder('친구들에게 보일 이름').fill(names[i]!)
    await p.getByText(`코드 ${code}`).first().waitFor()
    if (i === 2) await shot([p], '00-lobby-list')
    await p.getByText(`코드 ${code}`).first().click()
    await p.getByRole('button', { name: '입장', exact: true }).click()
    await waitText(p, '게임 설정')
  }
  await waitText(host, `4 / 8명`)
  await shot(pages, '01-lobby')

  // 3. 게임 시작 → 제시어 확인
  await host.getByRole('button', { name: '게임 시작' }).click()
  for (const p of pages) await p.getByRole('button', { name: '확인했어요' }).click()
  await shot(pages, '02-reveal')

  // 라이어 찾기 (라이어 모드: 화면에 "당신은 라이어입니다")
  await waitText(host, '설명')
  let liarIndex = -1
  for (let i = 0; i < pages.length; i++) {
    if (await pages[i]!.getByText('당신은 라이어입니다').count()) liarIndex = i
  }
  if (liarIndex < 0) throw new Error('라이어 화면을 찾지 못함')
  console.log(`라이어: ${names[liarIndex]}`)

  // 4. 설명: 내 차례인 사람이 입력
  for (let turn = 0; turn < pages.length; turn++) {
    let done = false
    for (let attempt = 0; attempt < 50 && !done; attempt++) {
      for (const p of pages) {
        const input = p.getByLabel('내 차례예요! 제시어를 한 줄로 설명하세요')
        if (await input.count()) {
          await input.fill(`설명 ${turn + 1}번`, { timeout: 3000 })
          await input.press('Enter')
          // 제출 후 내 입력창이 사라질 때까지 기다린다 (다음 차례와 헷갈리지 않도록)
          await input.waitFor({ state: 'detached', timeout: 5000 })
          done = true
          break
        }
      }
      if (!done) await host.waitForTimeout(100)
    }
    if (!done) throw new Error(`${turn}번째 설명 차례를 찾지 못함`)
    if (turn === 1) await shot(pages, '03-describe')
  }

  // 5. 토론: 채팅 한 번 → 방장이 바로 투표
  await waitText(host, '채팅으로 자유롭게 토론하세요')
  const chatInput = pages[1]!.getByPlaceholder('메시지 입력 (Enter)')
  await chatInput.fill('누가 라이어지?')
  await chatInput.press('Enter')
  await waitText(host, '누가 라이어지?')
  await shot(pages, '04-discuss')
  await host.getByRole('button', { name: '바로 투표' }).click()

  // 6. 투표: 모두 라이어에게 (라이어는 다른 사람에게)
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!
    await waitText(p, '라이어는 누구일까요?')
    const target = i === liarIndex ? names[(i + 1) % names.length]! : names[liarIndex]!
    await p.getByRole('button', { name: new RegExp(`^${target}`) }).click()
    if (i === 0) await shot(pages, '05-vote')
  }

  // 7. 라이어의 정답 도전 (틀린 답)
  const liar = pages[liarIndex]!
  await waitText(liar, '들켰어요!')
  await liar.getByLabel('시민들의 제시어는?').fill('모르겠어요')
  await shot(pages, '06-guess')
  await liar.getByRole('button', { name: '제출' }).click()

  // 8. 애매하면 판정 (기본: 방장 판정)
  await host.waitForTimeout(500)
  if (await host.getByText('정답으로 인정할까요?').count()) {
    await shot(pages, '07-judge')
    for (const p of pages) {
      const btn = p.getByRole('button', { name: '불인정' })
      if ((await btn.count()) && (await btn.isEnabled())) await btn.click()
    }
  }

  // 9. 결과
  for (const p of pages) await waitText(p, '시민 승리!')
  await shot(pages, '08-result')

  // 10. 다음 라운드가 시작되는지
  await host.getByRole('button', { name: '다음 라운드' }).click()
  await waitText(pages[3]!, '확인했어요')
  await shot(pages, '09-next-round')

  if (errors.length > 0) throw new Error(`브라우저 오류:\n${errors.join('\n')}`)
  console.log(`\n✅ 스모크 테스트 성공 — 스크린샷: ${outDir}`)
} catch (err) {
  console.error('\n❌ 스모크 테스트 실패:', err)
  if (errors.length) console.error(errors.join('\n'))
  process.exitCode = 1
} finally {
  await browser?.close()
  await server.close()
}
