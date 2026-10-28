<template>
  <div class="page">
    <header class="top">
      <a href="https://hollware.com" class="brand">Hollware</a>
      <span class="tag">demo</span>
    </header>
    <main>
      <NuxtPage />
    </main>
  </div>
</template>

<style>
:root {
  color-scheme: dark;
  --ground: #0e0c0a;
  --card: #17140f;
  --text: #e6dfd3;
  --strong: #f2ede4;
  --muted: #9e968a;
  --accent: #f0a93b;
  --line: rgb(255 255 255 / 0.1);
}
html {
  background: var(--ground);
  color: var(--text);
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  line-height: 1.65;
}
body {
  margin: 0;
}
.page {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}
.top {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 3rem;
}
.brand {
  color: var(--strong);
  font-weight: 700;
  text-decoration: none;
}
.tag,
.intro {
  color: var(--muted);
}
h1,
h2,
h3 {
  color: var(--strong);
  line-height: 1.2;
}
a {
  color: var(--accent);
}
li + li {
  margin-top: 0.5rem;
}
pre {
  overflow-x: auto;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--card);
}
code {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.9em;
}
img {
  max-width: 100%;
  height: auto;
}
</style>
