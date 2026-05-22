import type { InstrumentCategory } from './instrument-category'

import artworkConfig from './performer-artwork-config.json'

export interface PerformerArtworkAnchors {
	centerX: number
	footY: number
	headY: number
}

export type PerformerArtworkSource
	= | { anchors?: Partial<PerformerArtworkAnchors>, kind: 'asset', src: string }
		| { anchors?: Partial<PerformerArtworkAnchors>, kind: 'data-url', src: string }

export interface PerformerArtworkEntry {
	image: PerformerArtworkSource
	scale?: number
}

interface PerformerArtworkPreset {
	id: string
	label: string
	performers: Partial<Record<InstrumentCategory, PerformerArtworkEntry>>
}

interface PerformerArtworkConfig {
	activePresetId: string
	presets: PerformerArtworkPreset[]
}

const config = artworkConfig as PerformerArtworkConfig

export const defaultPerformerArtworkAnchors: PerformerArtworkAnchors = {
	centerX: 0.5,
	footY: 0.92,
	headY: 0.08,
}

export const activePerformerArtworkPresetId = config.activePresetId
export const performerArtworkPresets = config.presets

export function getPerformerArtworkEntry(category: InstrumentCategory, presetId = config.activePresetId): null | PerformerArtworkEntry {
	const preset = config.presets.find(item => item.id === presetId) ?? config.presets[0]
	return preset?.performers[category] ?? null
}

export function getPerformerArtworkSource(category: InstrumentCategory, presetId = config.activePresetId): null | PerformerArtworkSource {
	return getPerformerArtworkEntry(category, presetId)?.image ?? null
}

export function getPerformerArtworkScale(category: InstrumentCategory, presetId = config.activePresetId): number {
	const scale = getPerformerArtworkEntry(category, presetId)?.scale ?? 1
	return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function getPerformerArtworkAnchors(category: InstrumentCategory, presetId = config.activePresetId): PerformerArtworkAnchors {
	const anchors = getPerformerArtworkSource(category, presetId)?.anchors
	return sanitizeAnchors(anchors)
}

export function sanitizeAnchors(anchors: null | Partial<PerformerArtworkAnchors> | undefined): PerformerArtworkAnchors {
	return {
		centerX: clampAnchor(anchors?.centerX, defaultPerformerArtworkAnchors.centerX),
		footY: clampAnchor(anchors?.footY, defaultPerformerArtworkAnchors.footY),
		headY: clampAnchor(anchors?.headY, defaultPerformerArtworkAnchors.headY),
	}
}

function clampAnchor(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: fallback
}
