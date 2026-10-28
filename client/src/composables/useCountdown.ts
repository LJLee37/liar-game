/**
 * 서버가 알려 준 마감 시각(phaseEndsAt)까지 남은 초를 계산한다.
 * 서버와 내 기기의 시계가 다를 수 있어 clockOffset으로 보정한다.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'

export function useCountdown(endsAt: Ref<number | null>, clockOffset: Ref<number>) {
  const now = ref(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, 250)
  onBeforeUnmount(() => clearInterval(timer))

  const remainingMs = computed(() => {
    if (endsAt.value === null) return null
    return Math.max(0, endsAt.value - (now.value + clockOffset.value))
  })
  const seconds = computed(() => (remainingMs.value === null ? null : Math.ceil(remainingMs.value / 1000)))
  return { remainingMs, seconds }
}
