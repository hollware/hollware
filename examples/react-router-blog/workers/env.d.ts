// The module that React Router's Vite plugin makes of the app's routes.
declare module 'virtual:react-router/server-build' {
  import type { ServerBuild } from 'react-router'
  const build: ServerBuild
  export = build
}
