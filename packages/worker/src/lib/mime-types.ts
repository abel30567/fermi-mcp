const MIME_BY_EXT: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	js: 'application/javascript; charset=utf-8',
	mjs: 'application/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json; charset=utf-8',
	xml: 'application/xml; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	md: 'text/markdown; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	pdf: 'application/pdf',
	wasm: 'application/wasm',
	map: 'application/json; charset=utf-8',
}

export function getMimeType(path: string): string {
	const dot = path.lastIndexOf('.')
	if (dot === -1) return 'application/octet-stream'
	const ext = path.slice(dot + 1).toLowerCase()
	return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
