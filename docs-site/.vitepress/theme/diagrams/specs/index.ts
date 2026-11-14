import type { DiagramSpec } from '../types'
import { components } from './components'
import { flows } from './flows'
import { overview } from './overview'

export const specs: Record<string, DiagramSpec> = { ...overview, ...flows, ...components }
