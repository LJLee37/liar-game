/** 화면에 보여 줄 문구 */
import type { JudgementView, ResultReason } from '../../shared/protocol.ts'

export const RESULT_TEXT: Record<ResultReason, string> = {
  wrong_accusation: '시민을 라이어로 지목했어요. 라이어 승리!',
  tie: '재투표에서도 동점이 나와 라이어가 살아남았어요. 라이어 승리!',
  no_votes: '아무도 투표하지 않아 라이어가 살아남았어요. 라이어 승리!',
  guessed: '라이어가 잡혔지만 제시어를 맞혔어요. 라이어 승리!',
  guess_failed: '라이어를 잡았고, 제시어도 지켜냈어요. 시민 승리!',
  liar_left: '잡힌 라이어가 나가서 시민 승리!',
  aborted: '라운드가 중단되었어요.',
}

export const JUDGE_REASON_TEXT: Record<JudgementView['reason'], string> = {
  exact: '제시어와 일치',
  alias: '인정된 다른 표기(별칭)와 일치',
  'other-word': '같은 카테고리의 다른 단어',
  empty: '답을 입력하지 않음',
  similar: '오타·표기 차이로 판단',
  different: '다른 답으로 판단',
}

export const JUDGE_METHOD_TEXT: Record<JudgementView['method'], string> = {
  rule: '규칙으로 자동 처리',
  auto: '유사도 자동 판정',
  host: '방장 판정',
  vote: '플레이어 투표',
}

/** Enter 키 처리: 한글 조합 중(IME)에는 무시해야 마지막 글자가 중복 전송되지 않는다 */
export function isSubmitEnter(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229
}
