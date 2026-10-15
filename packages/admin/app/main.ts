import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './app.css'

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes: [{ path: '/', component: () => import('./pages/Home.vue') }],
})

createApp(App).use(router).use(ui).mount('#app')
