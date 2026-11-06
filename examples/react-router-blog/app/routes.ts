import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('blog/:slug', 'routes/post.tsx'),
  route('ayuda/*', 'routes/help.tsx'),
] satisfies RouteConfig
