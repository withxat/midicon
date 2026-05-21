import type { AudioEngine, EngineKind } from './types'

import { SpessaSynthEngine } from './spessasynth-engine'
import { ToneEngine } from './tone-engine'

export function createEngine(kind: EngineKind): AudioEngine {
	if (kind === 'tone') {
		return new ToneEngine()
	}
	return new SpessaSynthEngine()
}

export async function createPreferredEngine(): Promise<AudioEngine> {
	const spessa = createEngine('spessasynth')
	try {
		await spessa.load()
		return spessa
	}
	catch {
		spessa.dispose()
		const tone = createEngine('tone')
		await tone.load()
		return tone
	}
}
