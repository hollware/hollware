// The theme of Nuxt UI for hollware.com, the admin's too: black as primary, emerald, neutral greys,
// subtle inputs (tests/conventions/brand.test.ts).
export default defineAppConfig({
  ui: {
    colors: { primary: 'neutral', secondary: 'emerald', neutral: 'neutral' },
    input: { defaultVariants: { variant: 'subtle' } },
    textarea: { defaultVariants: { variant: 'subtle' } },
    select: { defaultVariants: { variant: 'subtle' } },
    selectMenu: { defaultVariants: { variant: 'subtle' } },
    inputMenu: { defaultVariants: { variant: 'subtle' } },
    inputNumber: { defaultVariants: { variant: 'subtle' } },
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
