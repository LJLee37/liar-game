# 배포 가이드

친구들이 접속할 수 있도록 서버를 띄우는 방법을 상황별로 정리했습니다.
어떤 방법이든 서버 자체는 같습니다. `npm run build`로 화면을 만들고 `npm start`(= `node server/index.ts`)로 실행합니다.

> ⚠️ **꼭 알아 둘 점: 서버는 반드시 1개만 실행**
> 방과 게임 상태는 서버 **메모리**에만 있습니다. 그래서 다음 두 가지에 주의해야 합니다.
> - 서버를 재시작하면 진행 중인 방이 모두 사라집니다.
> - 서버를 여러 대로 늘리면(로드 밸런싱) 방이 서로 보이지 않습니다.
>
> 친구들끼리 쓰는 규모라면 1대로 충분합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `HOST` | `0.0.0.0` | 바인딩 주소 (`0.0.0.0`은 같은 네트워크의 다른 기기에서도 접속 가능) |
| `WORDS_DIR` | `./words` | 단어 YAML 폴더 |
| `CLIENT_DIR` | `./dist/client` | 빌드된 화면 폴더 |
| `JUDGE_LOG_FILE` | `./data/judgements.jsonl` | 사람이 판정한 정답 기록. 빈 값(`JUDGE_LOG_FILE=`)이면 기록하지 않음 |
| `MAX_ROOMS` | `100` | 동시에 열 수 있는 최대 방 수 |

상태 확인용 주소는 `GET /healthz`입니다. 응답 예: `{"ok":true,"rooms":2}`

---

## 1. 같은 와이파이(LAN)에서 바로 하기 — 가장 간단

모두 같은 공유기에 연결되어 있을 때 쓰는 방법입니다.

```bash
npm ci
```

```bash
npm run build
```

```bash
npm start
```

1. 내 컴퓨터의 내부 IP를 확인합니다. Linux에서는 `hostname -I`, macOS에서는 `ipconfig getifaddr en0`입니다.
2. 친구들은 `http://<내부IP>:3000`으로 접속합니다.
3. 접속이 안 되면 방화벽에서 3000번 포트를 열어 줍니다. Ubuntu에서는 `sudo ufw allow 3000/tcp`입니다.

개발 중이라면 `npm run dev`로 실행해도 됩니다. 이때 터미널에 표시되는 Vite의 `Network: http://…:5173` 주소로 접속합니다.

---

## 2. Docker로 실행 (집 서버·VPS 공통)

Docker 문서: https://docs.docker.com/get-started/

```bash
docker build -t liar-game .
```

```bash
docker run -d --name liar-game --restart unless-stopped -p 3000:3000 -v liar-data:/app/data liar-game
```

- `-v liar-data:/app/data`: 판정 기록 파일을 컨테이너 밖(볼륨)에 보관합니다.
- **이미지를 다시 빌드하지 않고 단어만 바꾸고 싶다면** 단어 폴더를 읽기 전용으로 연결한 뒤, 단어를 수정할 때마다 `docker restart liar-game`을 실행합니다.

  ```bash
  docker run -d --name liar-game --restart unless-stopped -p 3000:3000 -v liar-data:/app/data -v "$(pwd)/words:/app/words:ro" liar-game
  ```

- 로그를 보려면 `docker logs -f liar-game`을 실행합니다. 이미지에 HEALTHCHECK(`/healthz`)가 들어 있어 `docker ps`에서 상태가 보입니다.
- 베이스 이미지는 보안 패치가 적용된 `node:22.23.4-alpine`으로 **고정**되어 있습니다(Dockerfile의 `ARG NODE_VERSION`).
  - `node:22-alpine` 같은 움직이는 태그는 빌드하는 컴퓨터에 받아 둔 옛 이미지가 그대로 쓰일 수 있어 피했습니다.
  - 다른 버전으로 빌드하려면 `docker build --build-arg NODE_VERSION=24.22.1 -t liar-game .`처럼 지정합니다.
  - 보안 패치 이전 버전을 지정하면 컨테이너가 시작하자마자 종료됩니다.

### docker compose 예시

```yaml
# compose.yaml
services:
  liar-game:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - liar-data:/app/data
      - ./words:/app/words:ro
volumes:
  liar-data:
```

---

## 3. 인터넷에 공개하기: 리버스 프록시 + HTTPS

외부(인터넷)에 공개할 때는 게임 서버를 직접 노출하지 않습니다. 대신 앞단의 **리버스 프록시**가 HTTPS를 처리하도록 하는 것이 일반적입니다.
이 게임은 **WebSocket**을 쓰므로, 프록시가 WebSocket 업그레이드를 넘겨주도록 설정해야 합니다.
참고: [Socket.IO — 리버스 프록시 뒤에서 쓰기](https://socket.io/docs/v4/reverse-proxy/)

### 3-1. Caddy (추천: 인증서 자동 발급·갱신)

Caddy는 도메인만 적으면 Let's Encrypt 인증서를 자동으로 발급하고 갱신합니다. WebSocket도 별도 설정 없이 그대로 전달합니다.
문서: https://caddyserver.com/docs/automatic-https

```
# /etc/caddy/Caddyfile
liar.example.com {
    reverse_proxy localhost:3000
}
```

인증서를 자동으로 발급받으려면 다음 조건이 필요합니다.
- 도메인의 DNS A/AAAA 레코드가 서버 IP를 가리켜야 합니다.
- 80/443 포트가 외부에서 접근 가능해야 합니다.

### 3-2. nginx

nginx는 WebSocket 업그레이드 헤더를 **직접** 넘겨줘야 합니다. 이 설정이 빠지면 화면은 뜨지만 "재연결 중…"이 계속 표시됩니다.
문서: https://nginx.org/en/docs/http/websocket.html

```nginx
server {
    listen 443 ssl;
    server_name liar.example.com;
    # ssl_certificate / ssl_certificate_key 는 certbot 등으로 발급

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
}
```

인증서 발급은 [Certbot](https://certbot.eff.org/)으로 할 수 있습니다.

### 3-3. 포트포워딩 없이 집 서버 공개: Cloudflare Tunnel

공유기 포트포워딩이 어렵거나 공인 IP가 없다면 Cloudflare Tunnel을 쓸 수 있습니다.
서버에서 Cloudflare로 나가는 연결을 만들어 외부에 공개하는 방식이고, WebSocket도 지원합니다.
도메인을 Cloudflare에 연결해야 합니다.
문서: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

---

## 4. Docker 없이 systemd로 상시 실행 (Linux)

서버에 **보안 업데이트가 적용된 Node.js**가 설치되어 있어야 합니다. 허용 버전은 `22.23.4 이상(22.x)`, `24.22.1 이상(24.x)`, `26.12.1 이상`입니다.
기준은 [2026-10-21 보안 릴리스](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)이며, 낮은 버전에서는 서버가 시작하지 않습니다.
배포판 기본 패키지(apt 등)의 Node는 오래된 경우가 많으니 [NodeSource](https://github.com/nodesource/distributions)나 [nvm](https://github.com/nvm-sh/nvm) 등으로 설치하세요.

```bash
cd /opt/liar-game && npm ci && npm run build && npm prune --omit=dev
```

```ini
# /etc/systemd/system/liar-game.service
[Unit]
Description=Liar Game server
After=network.target

[Service]
WorkingDirectory=/opt/liar-game
ExecStart=/usr/bin/node server/index.ts
Environment=PORT=3000
Restart=on-failure
User=liargame

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now liar-game
```

단어를 수정한 뒤에는 `sudo systemctl restart liar-game`을 실행합니다.
systemd 문서: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html

> Ansible로 서버 설정을 자동화한다면 위 내용을 그대로 작업(task)으로 옮길 수 있습니다.
> 순서는 Node 설치 → 저장소 체크아웃 → `npm ci && npm run build` → 서비스 파일 템플릿 배치 → `systemd` 모듈로 서비스 활성화입니다.

---

## 5. PaaS (Render, Fly.io 등)

Dockerfile이 있으므로 대부분의 PaaS에서 "Docker로 배포"를 선택하면 됩니다. 다만 다음 점을 확인하세요.

- **WebSocket을 지원하는지** 확인하세요.
- **인스턴스를 1개로 고정**하세요. 메모리에 상태가 있기 때문입니다.
- **무료 요금제는 잠들 수 있습니다.** 요청이 없으면 서버가 잠드는 경우가 많은데, 그러면 재시작과 같아서 방이 사라집니다.
  - 예: Render 무료 웹 서비스는 일정 시간 요청이 없으면 잠듭니다. https://render.com/docs/free
  - 예: Fly.io는 자동 중지 기능을 끄거나 `min_machines_running = 1`로 설정해 항상 켜 둘 수 있습니다. https://fly.io/docs/launch/autostop-autostart/
  - 위 요금제·정책은 **작성 시점 기준이며 바뀔 수 있습니다.** 공식 문서에서 최신 조건을 확인하세요.

---

## Node.js 보안 업데이트가 나왔을 때

Node.js 보안 릴리스는 [보안 공지 목록](https://nodejs.org/en/blog/vulnerability)에서 확인할 수 있습니다. 새 릴리스가 나오면 아래 순서로 반영합니다.

1. [`server/node-version.ts`](../server/node-version.ts)의 `SECURE_NODE_MINIMUMS`와 공지 링크를 새 패치 버전으로 바꿉니다.
2. `package.json`의 `engines.node`를 같은 범위로 바꿉니다. `npm test`가 1번과 같은지 검사합니다.
3. `Dockerfile`의 `ARG NODE_VERSION`을 바꿉니다. 이것도 테스트가 검사합니다.
4. 서버의 Node를 업데이트한 뒤 재시작합니다. Docker를 쓴다면 이미지를 다시 빌드해 배포합니다.

## 배포 후 확인 체크리스트

- [ ] `https://도메인/healthz`가 `{"ok":true,...}`로 응답하는지
- [ ] 두 기기(또는 브라우저 두 개)로 방을 만들고 입장했을 때 로비 목록에 방이 바로 보이는지
- [ ] 휴대폰에서 화면을 잠갔다가 돌아와도 자동으로 재접속되는지
- [ ] 화면 위쪽에 "재연결 중…"이 계속 떠 있지 않은지. 계속 떠 있다면 프록시의 WebSocket 설정을 확인하세요.
