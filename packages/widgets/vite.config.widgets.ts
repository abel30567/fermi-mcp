import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

const widgetsDir = path.resolve(__dirname, 'src')

// Auto-discover widget entries if directory exists
const entries = fs.existsSync(widgetsDir)
	? Object.fromEntries(
			fs.readdirSync(widgetsDir).flatMap((item) => {
				const itemPath = path.join(widgetsDir, item)
				const stat = fs.statSync(itemPath)
				if (stat.isFile() && /\.tsx?$/.test(item) && !item.startsWith('.'))
					return [[path.basename(item, path.extname(item)), itemPath]]
				if (stat.isDirectory()) {
					for (const ext of ['.tsx', '.ts']) {
						const indexPath = path.join(itemPath, `index${ext}`)
						if (fs.existsSync(indexPath)) return [[item, indexPath]]
					}
				}
				return []
			}),
		)
	: {}

export default defineConfig({
	build: {
		outDir: '../worker/public/widgets',
		rollupOptions: {
			input: entries,
			output: { entryFileNames: '[name].js', format: 'es' },
			preserveEntrySignatures: 'exports-only',
		},
	},
})
