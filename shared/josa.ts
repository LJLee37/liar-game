/**
 * 한국어 조사 붙이기: 앞 단어의 받침 유무에 따라 "이/가", "은/는", "을/를", "과/와"를 고른다.
 * 예: josa('짬뽕', '이', '가') → '짬뽕이', josa('"우동"', '과', '와') → '"우동"과'
 * 따옴표 등 끝의 기호는 건너뛰고 판단하며, 마지막 글자가 한글이 아니면(영문·숫자) "이(가)"처럼 둘 다 표시한다.
 */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const letters = word.match(/[\p{L}\p{N}]/gu)
  const last = letters?.at(-1) ?? ''
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code >= 11172) return `${word}${withFinal}(${withoutFinal})`
  return word + (code % 28 === 0 ? withoutFinal : withFinal)
}
