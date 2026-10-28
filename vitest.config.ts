import { defineConfig } from 'vitest/config'

// 서버·공용 코드 테스트 설정 (클라이언트 빌드 설정은 vite.config.ts)
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
