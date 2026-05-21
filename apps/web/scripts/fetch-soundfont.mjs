import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const targetDir = path.join(__dirname, '../public/soundfonts')
const targetFile = path.join(targetDir, 'A320U.sf2')
/** Pinned URL from ryohey/signal `SoundFontStore.ts` (Signal Factory Sound). */
const sourceUrl = 'https://cdn.jsdelivr.net/gh/ryohey/signal@4569a31/public/A320U.sf2'

async function main() {
	await mkdir(targetDir, { recursive: true })

	try {
		const existing = await stat(targetFile)
		if (existing.size > 1024 * 1024) {
			console.log(`SoundFont already present at ${targetFile}`)
			return
		}
	}
	catch {
		// File missing, continue with download.
	}

	console.log(`Downloading ${sourceUrl}`)
	const response = await fetch(sourceUrl)
	if (!response.ok || !response.body) {
		throw new Error(`Download failed (${response.status})`)
	}

	await pipeline(response.body, createWriteStream(targetFile))
	console.log(`Saved ${targetFile}`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
