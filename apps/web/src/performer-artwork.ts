import type { InstrumentCategory } from './instrument-category'

import artworkConfig from './performer-artwork-config.json'

export interface PerformerArtworkAnchors {
	centerX: number
	footY: number
	headY: number
}

export interface PerformerArtworkOffset {
	x: number
	y: number
}

export type PerformerArtworkSource
	= | { anchors?: Partial<PerformerArtworkAnchors>, kind: 'asset', scale?: number, src: string }
		| { anchors?: Partial<PerformerArtworkAnchors>, kind: 'data-url', scale?: number, src: string }

export interface PerformerArtworkStage {
	offset?: Partial<PerformerArtworkOffset>
	scale?: number
}

export interface PerformerArtworkEntry {
	image: PerformerArtworkSource
	stage?: PerformerArtworkStage
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

export const defaultPerformerArtworkOffset: PerformerArtworkOffset = {
	x: 0,
	y: 0,
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

export function getPerformerArtworkScale(source: null | PerformerArtworkSource): number {
	const scale = source?.scale ?? 1
	return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function getPerformerArtworkAnchors(category: InstrumentCategory, presetId = config.activePresetId): PerformerArtworkAnchors {
	const anchors = getPerformerArtworkSource(category, presetId)?.anchors
	return sanitizeAnchors(anchors)
}

export function getPerformerArtworkStageOffset(category: InstrumentCategory, presetId = config.activePresetId): PerformerArtworkOffset {
	const offset = getPerformerArtworkEntry(category, presetId)?.stage?.offset
	return {
		x: typeof offset?.x === 'number' && Number.isFinite(offset.x) ? offset.x : defaultPerformerArtworkOffset.x,
		y: typeof offset?.y === 'number' && Number.isFinite(offset.y) ? offset.y : defaultPerformerArtworkOffset.y,
	}
}

export function getPerformerArtworkStageScale(category: InstrumentCategory, presetId = config.activePresetId): number {
	const scale = getPerformerArtworkEntry(category, presetId)?.stage?.scale ?? 1
	return Number.isFinite(scale) && scale > 0 ? scale : 1
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
