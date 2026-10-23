import { useMessages } from '../i18n/index.ts'
import { createApi } from './api.ts'
import { createAuth } from './auth.ts'

export const auth = createAuth({
  fetch: (input, init) => fetch(input, init),
  navigate: (url) => {
    window.location.assign(url)
  },
  storage: window.sessionStorage,
  now: () => Date.now(),
  text: () => useMessages().value.auth,
})

export const api = createApi({
  fetch: (input, init) => fetch(input, init),
  auth,
  here: () => `${window.location.pathname}${window.location.search}`,
  text: () => useMessages().value.api,
})
