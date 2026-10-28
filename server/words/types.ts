/** 단어 하나 */
export interface Word {
  /** 화면에 보이는 단어 */
  text: string
  /** 정답으로 자동 인정되는 다른 표기 */
  aliases: string[]
  /** 소분류 이름 (없으면 null) */
  group: string | null
  /** YAML 파일의 줄 번호 (오류 표시용) */
  line: number
  /** 정규화된 비교 키: 단어 + 별칭 (중복 제거) */
  keys: string[]
}

/** 카테고리 하나 = YAML 파일 하나 */
export interface Category {
  /** 파일 이름에서 확장자를 뺀 것 (예: food) */
  id: string
  file: string
  name: string
  icon: string | null
  description: string | null
  words: Word[]
}

export type IssueLevel = 'error' | 'warn' | 'info'

/** 검사 결과 한 건 */
export interface Issue {
  level: IssueLevel
  code: string
  file: string
  line?: number
  message: string
}

/** 게임에서 사용하는 단어 묶음 */
export interface WordBank {
  /** 이름순 정렬 */
  categories: Category[]
  byId: Map<string, Category>
}
