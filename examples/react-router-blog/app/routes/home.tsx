import { hollware } from '../hollware.server.ts'
import { Link, useLoaderData } from 'react-router'

export async function loader() {
  const { entries } = await hollware.listEntries('blog', { locale: 'en', limit: 20 })
  return { posts: entries.map((post) => ({ slug: post.slug, title: titleOf(post) })) }
}

function titleOf(post: { slug: string; frontmatter: Record<string, unknown> }): string {
  const { title } = post.frontmatter
  return typeof title === 'string' ? title : post.slug
}

export function meta() {
  return [{ title: 'Blog' }]
}

export default function Home() {
  const { posts } = useLoaderData<typeof loader>()
  return (
    <>
      <h1>Blog</h1>
      <ul>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link to={`/blog/${post.slug}`}>{post.title}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}
