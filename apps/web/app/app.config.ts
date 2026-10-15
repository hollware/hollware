// The theme of Nuxt UI for hollware.com: mint for what acts, ink for everything else.
export default defineAppConfig({
  ui: {
    colors: { primary: 'mint', neutral: 'ink' },
    button: { slots: { base: 'font-medium' } },
    pageHero: {
      slots: {
        title: 'text-gradient tracking-[-0.035em] font-semibold',
        description: 'text-pretty',
      },
    },
    pageFeature: { slots: { title: 'font-medium' } },
  },
})
