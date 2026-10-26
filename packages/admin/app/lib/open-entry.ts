import { shallowRef } from 'vue'
import type { EntryCommands } from './commands.ts'

export const openEntry = shallowRef<EntryCommands | null>(null)
