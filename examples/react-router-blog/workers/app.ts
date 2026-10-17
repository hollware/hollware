import { createRequestHandler } from 'react-router'

// The server build is the app's routes, made by React Router's Vite plugin.
const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

export default {
  fetch(request) {
    return requestHandler(request)
  },
} satisfies ExportedHandler
