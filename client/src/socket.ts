/**
 * 서버와의 실시간 연결(Socket.IO 클라이언트).
 * https://socket.io/docs/v4/client-api/
 */
import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { ERROR_MESSAGES } from '../../shared/constants.ts'
import type { AckResponse, ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.ts'

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** 같은 주소(origin)의 서버에 접속. 개발 중에는 Vite가 /socket.io를 게임 서버로 넘겨준다. */
export const socket: GameSocket = io({
  transports: ['websocket', 'polling'],
  reconnectionDelayMax: 3000,
})

const REQUEST_TIMEOUT_MS = 6000
const CONNECT_WAIT_MS = 8000

/** 연결될 때까지 기다린다 (페이지를 처음 열었을 때 연결보다 요청이 먼저 나가지 않도록). 연결되면 true */
export function waitForConnection(ms = CONNECT_WAIT_MS): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect)
      resolve(false)
    }, ms)
    function onConnect() {
      clearTimeout(timer)
      resolve(true)
    }
    socket.once('connect', onConnect)
  })
}

/**
 * 서버에 요청을 보내고 응답(ack)을 기다린다. 응답이 없으면 TIMEOUT 오류를 돌려준다.
 * 예: await request(s => s.emitWithAck('game:start'))
 */
export async function request<T extends object>(
  send: (s: ReturnType<GameSocket['timeout']>) => Promise<AckResponse<T>>,
): Promise<AckResponse<T>> {
  if (!(await waitForConnection())) return { ok: false, error: 'TIMEOUT', message: '서버에 연결할 수 없어요.' }
  try {
    return await send(socket.timeout(REQUEST_TIMEOUT_MS))
  } catch {
    return { ok: false, error: 'TIMEOUT', message: ERROR_MESSAGES.TIMEOUT }
  }
}
