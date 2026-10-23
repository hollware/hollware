import { addCollection } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { auth } from './lib/session.ts'
import { isStaleFile, loadAgainOnce, sessionStore } from './lib/stale.ts'
import './app.css'

if (__HOLLWARE_ICONS__ !== null) addCollection(__HOLLWARE_ICONS__)

const BASE = '/admin'

const router = createRouter({
  history: createWebHistory(`${BASE}/`),
  routes: [
    { path: '/', component: () => import('./pages/Home.vue') },
    { path: '/entries', component: () => import('./pages/Entries.vue') },
    { path: '/entries/new', component: () => import('./pages/NewEntry.vue') },
    {
      path: '/entries/:collection/:locale/:slug',
      component: () => import('./pages/Entry.vue'),
      props: true,
    },
    { path: '/reviews', component: () => import('./pages/Reviews.vue') },
    { path: '/images', component: () => import('./pages/Images.vue') },
    { path: '/collections', component: () => import('./pages/Collections.vue') },
    {
      path: '/collections/:name',
      component: () => import('./pages/Collection.vue'),
      props: true,
    },
    { path: '/site', component: () => import('./pages/Site.vue') },
    { path: '/tokens', component: () => import('./pages/Tokens.vue') },
    { path: '/people', component: () => import('./pages/People.vue') },
    { path: '/activity', component: () => import('./pages/Activity.vue') },
    { path: '/account', component: () => import('./pages/Account.vue') },
    { path: '/callback', component: () => import('./pages/Callback.vue'), meta: { open: true } },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta['open'] === true) return true
  if ((await auth.token()) !== null) return true
  await auth.signIn(`${BASE}${to.fullPath}`)
  return false
})

let going: string | null = null
router.beforeEach((to) => {
  going = to.fullPath
})
router.afterEach(() => {
  going = null
})
const loadNewVersion = () =>
  loadAgainOnce(sessionStore(), Date.now(), () => {
    if (going === null) window.location.reload()
    else window.location.assign(`${BASE}${going}`)
  })
router.onError((error: unknown) => {
  if (isStaleFile(error)) loadNewVersion()
})
window.addEventListener('vite:preloadError', (event) => {
  if (loadNewVersion()) event.preventDefault()
})

createApp(App).use(router).use(ui).mount('#app')
