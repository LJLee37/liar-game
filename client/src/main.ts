/**
 * 클라이언트 진입점.
 * Vue: https://ko.vuejs.org  /  Quasar: https://quasar.dev  /  Pinia: https://pinia.vuejs.org  /  Vue Router: https://router.vuejs.org
 */
import { createPinia } from 'pinia'
import { Dialog, Notify, Quasar } from 'quasar'
import quasarLang from 'quasar/lang/ko-KR'
import { createApp } from 'vue'
import '@quasar/extras/material-icons/material-icons.css'
import 'quasar/src/css/index.sass'
import App from './App.vue'
import { router } from './router.ts'
import './style.css'

createApp(App)
  .use(Quasar, {
    plugins: { Notify, Dialog },
    lang: quasarLang,
    config: {
      dark: 'auto', // 기기의 다크 모드 설정을 따른다
      notify: { position: 'top', timeout: 2500 },
    },
  })
  .use(createPinia())
  .use(router)
  .mount('#app')
