import { createApi } from './api.ts'
import { createAuth } from './auth.ts'

/** The admin's sign-in and its calls, over the browser's own fetch, storage and address bar. */
export const auth = createAuth({
  fetch: (input, init) => fetch(input, init),
  navigate: (url) => {
    window.location.assign(url)
  },
  storage: window.sessionStorage,
  now: () => Date.now(),
})

export const api = createApi({
  fetch: (input, init) => fetch(input, init),
  auth,
  here: () => `${window.location.pathname}${window.location.search}`,
})
