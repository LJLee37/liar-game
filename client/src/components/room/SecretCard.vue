<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useRoomStore } from '../../stores/room.ts'

/** compact: 진행 중 화면 위쪽에 작게 표시 */
defineProps<{ compact?: boolean }>()

const room = useRoomStore()
const { round } = storeToRefs(room)
const hidden = ref(false)

const secret = computed(() => round.value?.secret ?? { kind: 'none' as const })
</script>

<template>
  <q-card v-if="round" flat bordered :class="secret.kind === 'liar' ? 'bg-accent text-white' : ''">
    <q-card-section :class="compact ? 'row items-center q-py-sm' : 'text-center q-py-lg'">
      <div :class="compact ? 'col' : ''">
        <div class="text-caption" :class="compact ? '' : 'q-mb-sm'">
          카테고리: {{ round.categoryIcon ?? '' }} {{ round.categoryName }}
        </div>
        <template v-if="hidden">
          <div :class="compact ? 'text-subtitle1' : 'text-h4'">●●●</div>
        </template>
        <template v-else-if="secret.kind === 'word'">
          <div :class="compact ? 'text-subtitle1 text-weight-bold' : 'text-h3 text-weight-bold q-my-md'">
            {{ secret.word }}
          </div>
          <div v-if="!compact && round.mode === 'fool'" class="text-caption text-grey">
            바보 모드: 누군가는 비슷한 다른 단어를 받았어요. 내가 라이어일 수도 있어요!
          </div>
        </template>
        <template v-else-if="secret.kind === 'liar'">
          <div :class="compact ? 'text-subtitle1 text-weight-bold' : 'text-h3 text-weight-bold q-my-md'">
            당신은 라이어입니다
          </div>
          <div v-if="!compact" class="text-body2">들키지 않게 설명하고, 다른 사람의 설명으로 제시어를 추리하세요.</div>
        </template>
        <template v-else>
          <div class="text-subtitle1 text-grey">관전 중이에요. 다음 라운드부터 참가해요.</div>
        </template>
      </div>
      <q-btn
        v-if="secret.kind !== 'none'"
        flat
        dense
        :icon="hidden ? 'visibility' : 'visibility_off'"
        :label="hidden ? '보기' : '가리기'"
        :class="compact ? '' : 'q-mt-sm'"
        @click="hidden = !hidden"
      />
    </q-card-section>
  </q-card>
</template>
