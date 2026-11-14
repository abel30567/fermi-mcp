import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './tokens.css'
import './brand.css'
import './diagrams/diagrams.css'
import Diagram from './diagrams/Diagram.vue'

export default {
	extends: DefaultTheme,
	enhanceApp({ app }) {
		app.component('Diagram', Diagram)
	},
} satisfies Theme
