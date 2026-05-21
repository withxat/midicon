interface WebMscoreScore {
	destroy: () => void
	saveXml: () => Promise<string>
}

interface WebMscoreRuntime {
	load: (format: 'midi', data: Uint8Array, fonts?: Uint8Array[], doLayout?: boolean) => Promise<WebMscoreScore>
	ready: Promise<void>
}

const webMscoreUrl = 'https://cdn.jsdelivr.net/npm/webmscore@1.2.1/webmscore.cdn.mjs'

export async function convertMidiToMusicXml(midiBinary: ArrayBuffer): Promise<null | string> {
	let score: null | WebMscoreScore = null

	try {
		const { default: WebMscore } = await import(/* @vite-ignore */ webMscoreUrl) as { default: WebMscoreRuntime }
		await WebMscore.ready
		score = await WebMscore.load('midi', new Uint8Array(midiBinary))
		const musicXml = await score.saveXml()
		return isMusicXml(musicXml) ? musicXml : null
	}
	catch {
		return null
	}
	finally {
		score?.destroy()
	}
}

function isMusicXml(value: string) {
	return value.includes('<score-partwise') || value.includes('<score-timewise')
}
