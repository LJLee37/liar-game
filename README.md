# 🤥 라이어 게임 (온라인)

친구들과 브라우저로 즐기는 온라인 라이어 게임입니다. PC와 휴대폰에서 모두 플레이할 수 있습니다.

- **두 가지 모드**
  - **라이어 모드**: 라이어에게 "당신은 라이어입니다"라고 알려 줍니다.
  - **바보 모드**: 라이어도 같은 카테고리의 비슷한 다른 제시어를 받고, 자신이 라이어인지 모릅니다.
- **로비와 여러 방**: 공개 방 목록이 실시간으로 갱신됩니다. 비공개 방과 비밀번호, 초대 링크(`/room/ABCD`)를 지원합니다.
- **텍스트로 진행**: 한 줄 설명은 순서대로, 토론은 채팅으로 합니다. 게임 밖 음성 채팅 없이도 플레이할 수 있습니다.
- **똑똑한 정답 판정**: 띄어쓰기와 대소문자, 오타(`초콜렛`→`초콜릿`), 등록된 별칭(`핸드폰`→`스마트폰`)을 자동으로 처리합니다. 애매한 답은 **자동 / 방장 / 플레이어 투표** 중 방 설정에 따라 판정합니다.
- **YAML 단어 목록**: 23개 카테고리, 1,169개 단어, 별칭 399개가 들어 있습니다. 파일 하나를 추가하면 카테고리가 하나 늘어나고, 중복 검사 도구가 함께 있습니다.
- **접속이 끊겨도 이어서 플레이**: 자동으로 재접속하고, 방장이 오래 끊기면 다음 사람에게 방장이 넘어갑니다.

게임 규칙 전체는 [docs/RULES.md](docs/RULES.md)를 참고하세요.

## 빠른 시작

### 준비물
- [Node.js](https://nodejs.org/ko) **보안 업데이트가 적용된 버전**: `22.23.4 이상(22.x)`, `24.22.1 이상(24.x)`, `26.12.1 이상` 중 하나
  - 기준: [2026년 10월 21일 Node.js 보안 릴리스](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). TLS 인증서 호스트 검증 우회, DNS·Brotli 관련 High 등급 취약점이 수정되었습니다.
  - 23.x와 25.x는 지원이 끝나 패치가 나오지 않았으므로 쓸 수 없습니다.
  - 버전 확인: `node --version`
  - 조건에 맞지 않는 Node에서는 설치와 실행이 모두 막힙니다.
    - **설치**: `.npmrc`의 `engine-strict=true` 때문에 `npm ci`가 거부됩니다.
    - **실행**: 서버가 시작할 때 버전을 검사하고 종료합니다.
  - 기준 버전은 [`server/node-version.ts`](server/node-version.ts)에 있습니다. 새 보안 릴리스가 나오면 이 파일과 `package.json`의 `engines`, `Dockerfile`의 `NODE_VERSION`을 함께 올리세요. 셋이 어긋나면 테스트가 실패합니다.

### 개발 모드로 실행

```bash
npm ci
```

```bash
npm run dev
```

- 게임 서버(3000번 포트)와 화면 개발 서버([Vite](https://ko.vite.dev/), 5173번 포트)가 함께 뜹니다.
- 브라우저에서 http://localhost:5173 으로 접속합니다.
- 혼자 테스트할 때는 **탭을 여러 개** 열면 됩니다. 탭마다 다른 플레이어가 됩니다.
- 같은 와이파이의 친구들은 터미널에 표시되는 `Network: http://…:5173` 주소로 접속합니다.
- 서버 코드나 단어 파일을 고치면 서버가 자동으로 재시작됩니다. 이때 진행 중인 방은 사라집니다.

### 운영 모드로 실행

```bash
npm run build
```

```bash
npm start
```

http://localhost:3000 으로 접속합니다. 화면과 서버가 같은 포트를 씁니다.
인터넷에 공개하는 방법(Docker, HTTPS, Cloudflare Tunnel, systemd, PaaS)은 [docs/DEPLOY.md](docs/DEPLOY.md)에 있습니다.

## 단어 목록 관리

단어는 [`words/`](words/) 폴더의 YAML 파일로 관리합니다. **파일 하나가 카테고리 하나**입니다.

```yaml
# words/food.yaml
name: 음식
icon: 🍜
groups:
  면 요리:            # 소분류: 바보 모드에서 라이어 단어를 같은 소분류에서 고름
    - 짜장면: [자장면]  # 별칭 = 정답으로 자동 인정되는 다른 표기
    - 짬뽕
```

```bash
npm run check:words
```

이 명령은 중복 단어, 별칭 충돌, 형식 오류를 검사합니다. 오류가 있으면 실패로 끝나서 CI(GitHub Actions)에서도 걸러집니다.
작성 규칙과 별칭 정책, 검사 옵션은 [words/README.md](words/README.md)를 참고하세요.

방장이나 플레이어가 "정답으로 인정"한 답은 `data/judgements.jsonl`에 쌓입니다.

```bash
npm run check:words -- --suggest data/judgements.jsonl
```

위 명령으로 별칭 후보를 확인해 단어 파일에 추가하면, 다음부터는 자동으로 인정됩니다.

## 프로젝트 구조

```
shared/            서버·화면이 함께 쓰는 타입(protocol.ts)과 규칙 상수(constants.ts)
server/
  index.ts         실행 진입점 (환경 변수, 단어 로드)
  app.ts           HTTP(Express) + Socket.IO 서버
  socket.ts        실시간 이벤트 처리, 플레이어별 화면 정보 전송, 타이머
  lobby.ts         방 목록·생성·삭제·비밀번호
  game.ts          게임 규칙 상태 머신 (네트워크와 무관한 순수 로직)
  judge.ts         정답 판정 (정규화, 자모 분해, 편집 거리)
  words/           YAML 단어 로더와 검사 규칙
client/src/        화면 (Vue 3 + Quasar)
  pages/           로비, 방 화면
  components/      단계별 화면 조각 (설명, 투표, 판정, 결과 등)
  stores/          상태 저장소 (Pinia)
words/             단어 YAML, 스키마, 작성 가이드
scripts/           단어 검사 CLI, 브라우저 스모크 테스트
test/              통합 테스트와 테스트용 단어 파일
docs/              게임 규칙, 배포 가이드
```

### 설계 포인트
- **서버가 모든 판단을 합니다.** 화면(클라이언트)은 서버가 보내 준 정보를 보여 주기만 합니다.
- **정보는 플레이어마다 따로 보냅니다.** 서버는 `viewFor()`로 플레이어별 정보를 만들어 보내므로, 다른 사람의 제시어나 라이어가 누구인지는 결과 화면 전까지 브라우저에 **전달되지 않습니다.** 개발자 도구로 엿봐도 알 수 없습니다.
- **게임 규칙(`game.ts`)은 시간과 난수를 주입받는 순수 함수입니다.** 그래서 테스트에서 시간을 마음대로 돌려 볼 수 있습니다.

## 개발 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 모드 (서버 + Vite) |
| `npm run build` | 화면 빌드 → `dist/client` |
| `npm start` | 운영 모드 실행 |
| `npm test` | 전체 테스트 ([Vitest](https://vitest.dev/)): 판정기, 단어 로더, 게임 규칙(누출 검사, 무작위 퍼즈 포함), 소켓 통합 테스트 |
| `npm run typecheck` | 타입 검사 (`vue-tsc` + `tsc`) |
| `npm run check:words` | 단어 목록 검사 |
| `npm run smoke` | 실제 브라우저 4개(1개는 iPhone 화면)로 한 판을 자동 진행하고 `smoke-output/`에 스크린샷 저장 (먼저 `npm run build` 필요, [Playwright](https://playwright.dev/docs/intro) 설치 필요) |

### 손으로 확인할 것 (자동화가 어려운 부분)
한글 입력기(IME)에서 Enter로 제출할 때 마지막 글자가 두 번 들어가지 않는지 실제 기기에서 확인하세요.
코드는 조합 중인 Enter를 무시하도록 처리되어 있습니다.

- [ ] macOS Chrome / Safari
- [ ] iPhone Safari
- [ ] Android (삼성 키보드, Gboard)

## 기술 스택과 참고 문서

| 영역 | 사용 기술 | 문서 |
|---|---|---|
| 언어 | TypeScript (서버는 Node 22의 [타입 스트리핑](https://nodejs.org/api/typescript.html)으로 직접 실행) | https://www.typescriptlang.org/ko/docs/ |
| 서버 | Node.js, Express 5, Socket.IO 4 | https://expressjs.com/ko/ · https://socket.io/docs/v4/ |
| 화면 | Vue 3, Quasar 2, Pinia, Vue Router | https://ko.vuejs.org/ · https://quasar.dev/ · https://pinia.vuejs.org/ · https://router.vuejs.org/ |
| 빌드 | Vite | https://ko.vite.dev/ |
| 단어 파일 | YAML (`yaml` 패키지, failsafe 스키마) | https://eemeli.org/yaml/ |
| 테스트 | Vitest, socket.io-client, Playwright | https://vitest.dev/ · https://playwright.dev/ |
