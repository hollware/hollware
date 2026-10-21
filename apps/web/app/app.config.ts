// The theme of Nuxt UI for hollware.com, the admin's too: Carbón's warm white as primary, flame
// (the brand's amber) as secondary, Carbón greys, subtle inputs (ADR-039, tests/conventions/brand.test.ts).
export default defineAppConfig({
  ui: {
    colors: { primary: 'carbon', secondary: 'flame', neutral: 'carbon' },
    input: { defaultVariants: { variant: 'subtle' } },
    textarea: { defaultVariants: { variant: 'subtle' } },
    select: { defaultVariants: { variant: 'subtle' } },
    selectMenu: { defaultVariants: { variant: 'subtle' } },
    inputMenu: { defaultVariants: { variant: 'subtle' } },
    inputNumber: { defaultVariants: { variant: 'subtle' } },
  },
})
