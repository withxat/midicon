import type { InstrumentCategory } from './instrument-category'

import artworkConfig from './performer-artwork-config.json'

export type PerformerArtworkSource
	= | { kind: 'asset', src: string }
		| { kind: 'data-url', src: string }

interface PerformerArtworkPreset {
	id: string
	label: string
	performers: Partial<Record<InstrumentCategory, { image: PerformerArtworkSource }>>
}

interface PerformerArtworkConfig {
	activePresetId: string
	presets: PerformerArtworkPreset[]
}

const config = artworkConfig as PerformerArtworkConfig

export const performerArtworkPresets = config.presets

export function getPerformerArtworkSource(category: InstrumentCategory, presetId = config.activePresetId): null | PerformerArtworkSource {
	const preset = config.presets.find(item => item.id === presetId) ?? config.presets[0]
	return preset?.performers[category]?.image ?? null
}
