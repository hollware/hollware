import { addCollection } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { auth } from './lib/session.ts'
import './app.css'

// The icons travel in the bundle: the page may fetch nothing from another origin.
if (__HOLLWARE_ICONS__ !== null) addCollection(__HOLLWARE_ICONS__)

const BASE = '/admin'

// Dark, as hollware.com, until the person picks a theme (Nuxt UI keeps the choice here).
try {
  if (window.localStorage.getItem('vueuse-color-scheme') === null) {
    window.localStorage.setItem('vueuse-color-scheme', 'dark')
  }
} catch {
  // Storage can be off; the theme then follows the system.
}

const router = createRouter({
  history: createWebHistory(`${BASE}/`),
  routes: [
    { path: '/', component: () => import('./pages/Entries.vue') },
    { path: '/entries/new', component: () => import('./pages/NewEntry.vue') },
    {
      path: '/entries/:collection/:locale/:slug',
      component: () => import('./pages/Entry.vue'),
      props: true,
    },
    { path: '/reviews', component: () => import('./pages/Reviews.vue') },
    { path: '/tokens', component: () => import('./pages/Tokens.vue') },
    { path: '/people', component: () => import('./pages/People.vue') },
    { path: '/callback', component: () => import('./pages/Callback.vue'), meta: { open: true } },
  ],
})

// Every page but the callback needs a token: without one, the person signs in and comes back.
router.beforeEach(async (to) => {
  if (to.meta['open'] === true) return true
  if ((await auth.token()) !== null) return true
  await auth.signIn(`${BASE}${to.fullPath}`)
  return false
})

createApp(App).use(router).use(ui).mount('#app')
