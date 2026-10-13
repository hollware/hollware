/**
 * What the package entry does with these modules: it exports them whole, side by side. A name that
 * two of them export is an error here (TS2308), which `vp check` reports before the entry has it.
 */
export * from '../../src/config/index.ts'
export * from '../../src/contracts/index.ts'
export * from '../../src/operations/index.ts'
