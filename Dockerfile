# 라이어 게임 서버 이미지
#   docker build -t liar-game .
#   docker run -d -p 3000:3000 -v liar-data:/app/data --name liar-game liar-game
# 자세한 내용: docs/DEPLOY.md

# Node.js 버전은 보안 패치가 적용된 버전으로 고정한다 (2026-10-21 보안 릴리스, server/node-version.ts 참고).
# 새 보안 릴리스가 나오면 이 값과 package.json engines, server/node-version.ts를 함께 올린다.
ARG NODE_VERSION=22.23.4

# ── 1단계: 클라이언트 빌드 (Vue + Quasar → 정적 파일) ──
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── 2단계: 실행 이미지 (서버 실행에 필요한 것만) ──
# Node 22.18 이상은 TypeScript(.ts)를 그대로 실행할 수 있어 서버는 따로 빌드하지 않는다.
FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY words ./words
COPY --from=build /app/dist/client ./dist/client
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
# 판정 기록(data/judgements.jsonl)을 컨테이너 밖에 보관
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" > /dev/null || exit 1
CMD ["node", "server/index.ts"]
