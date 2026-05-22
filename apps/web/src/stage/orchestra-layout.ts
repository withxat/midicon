import type { InstrumentCategory } from '../instrument-category'
import type { Performer } from '../song'

import { MathUtils } from 'three'

/**
 * Top-down theater stage. An orthographic camera looks straight down the
 * -z axis, so the visible plane is (x, y). Performers are 2D sprites
 * scattered across the stage floor (an ellipse centered slightly below the
 * screen). Performers closer to the audience (smaller y) read as "in front"
 * — bigger sprite, drawn on top.
 *
 * Sizing strategy: the theater backdrop is rendered at a fixed world size
 * and the camera zoom is chosen so that backdrop *covers* the viewport.
 * That way performers, which live at fixed world coordinates, stay at the
 * exact same visual size relative to the stage on every resize.
 */

export type OrchestraSection
	= | 'brass'
		| 'guitar'
		| 'keyboard'
		| 'other'
		| 'percussion'
		| 'strings'
		| 'strings-bass'
		| 'synth'
		| 'woodwind'

export interface StagePlacement {
	/** Base position [x, y, z]. z encodes draw depth. */
	position: [number, number, number]
	/** Higher renders later (in front), mirrors `position.z`. */
	renderOrder: number
	/** Sprite scale derived from y depth (front rows render larger). */
	scale: number
	/** Logical stage section the performer belongs to. */
	section: OrchestraSection
}

/* -------------------------------------------------------------------------- */
/*                                  Viewport                                  */
/* -------------------------------------------------------------------------- */

/** Aspect ratio of the bundled theater backdrop (1536 × 1024 → 1.5). */
export const theaterImageAspect = 1.5
/**
 * Stable world-space height of the backdrop plane — the *single source of
 * truth* for the scene's scale. Everything else (character size, stage
 * floor radii, row Y positions) is defined as a fraction of this value, so
 * tweaking it rescales the whole scene proportionally without having to
 * re-tune every other constant.
 */
export const backgroundWorldHeight = 5.5
export const backgroundWorldWidth = backgroundWorldHeight * theaterImageAspect

/** Base sprite size for performer planes, expressed in world units. */
export const characterBaseHeight = backgroundWorldHeight * 0.36 // ≈ 1.98
export const characterBaseWidth = characterBaseHeight

export interface WorldViewport {
	aspect: number
	/** Visible world height (canvas px / zoom). Always equals `backgroundWorldHeight`. */
	worldHeight: number
	/** Visible world width (canvas px / zoom). */
	worldWidth: number
	/** Zoom for THREE.OrthographicCamera (`zoom = pixels / world_units`). */
	zoom: number
}

/**
 * Fit-by-height policy: the backdrop's height always exactly fills the
 * canvas height, regardless of viewport aspect. Wider viewports show empty
 * space on the sides of the image (which the page background fills with
 * the dark theme color); narrower viewports crop the image horizontally.
 *
 * Because zoom = pixelHeight / backgroundWorldHeight, every world-space
 * length renders as a constant fraction of the canvas height, so the
 * performers' on-screen size is locked to the backdrop's on-screen size.
 */
export function computeWorldViewport(size: { height: number, width: number }): WorldViewport {
	const safeWidth = size.width > 0 ? size.width : 1
	const safeHeight = size.height > 0 ? size.height : 1
	const zoom = safeHeight / backgroundWorldHeight
	return {
		aspect: safeWidth / safeHeight,
		worldHeight: backgroundWorldHeight,
		worldWidth: safeWidth / zoom,
		zoom,
	}
}

/* -------------------------------------------------------------------------- */
/*                                Stage floor                                 */
/* -------------------------------------------------------------------------- */

/**
 * The wooden stage floor inside the backdrop, calibrated to the bundled
 * theater image. All values are fractions of the background dimensions
 * — change `backgroundWorldHeight` above and the floor scales with it.
 *
 * The floor sits in the lower-middle of the image, centered around image
 * v ≈ 0.61 (so a negative world y), spanning roughly the middle 56 % of
 * the image width and the lower 47 % of its height.
 */
export const stageCenter = {
	x: 0,
	y: -0.18 * backgroundWorldHeight, // ≈ -0.99, sits the foot-anchored characters on the stage floor
} as const
/** Horizontal half-extent of the visible stage floor. */
export const stageRadiusX = 0.27 * backgroundWorldWidth // ≈ 2.23
/** Vertical half-extent of the visible stage floor. */
export const stageRadiusY = 0.23 * backgroundWorldHeight // ≈ 1.27

/* -------------------------------------------------------------------------- */
/*                              Depth (y → scale)                             */
/* -------------------------------------------------------------------------- */

/**
 * Sprite scale range, expressed relative to `characterBaseHeight`. With
 * the defaults a back-row character is ~0.46 units tall (≈ 8 % of
 * background height) and a front-row character ~0.69 units (≈ 12 %),
 * comfortably inside the floor while still reading as "performers".
 */
const minDepthScale = 0.30
const maxDepthScale = 0.45

/** y-range used to interpolate the depth scale (front = min y, back = max y). */
const minPlacementY = stageCenter.y - stageRadiusY * 0.25 // ≈ -0.87
const maxPlacementY = stageCenter.y + stageRadiusY * 1.00 // ≈  0.72

/** Range of z used to keep sprites in the correct paint order. */
const minDepthZ = 0
const maxDepthZ = 5

/* -------------------------------------------------------------------------- */
/*                                   Layout                                   */
/* -------------------------------------------------------------------------- */

type StageRow = 'back' | 'front' | 'middle'

const categoryToSection: Record<InstrumentCategory, OrchestraSection> = {
	bass: 'strings-bass',
	brass: 'brass',
	choir: 'woodwind',
	ethnic: 'other',
	flute: 'woodwind',
	guitar: 'guitar',
	mallet: 'percussion',
	organ: 'keyboard',
	percussion: 'percussion',
	piano: 'keyboard',
	reed: 'woodwind',
	strings: 'strings',
	synth: 'synth',
}

/** Which stage row each section sits in. */
const sectionRow: Record<OrchestraSection, StageRow> = {
	'brass': 'middle',
	'guitar': 'front',
	'keyboard': 'front',
	'other': 'middle',
	'percussion': 'back',
	'strings': 'front',
	'strings-bass': 'front',
	'synth': 'middle',
	'woodwind': 'middle',
}

/**
 * Left-to-right order of sections inside their row. Mirrors the classic
 * pit layout: keyboards stage-left, then guitars, strings, bass; woodwinds
 * → brass → other → synth across the middle; drums at the back.
 */
const sectionOrderInRow: Record<OrchestraSection, number> = {
	'brass': 2,
	'guitar': 1,
	'keyboard': 0,
	'other': 3,
	'percussion': 0,
	'strings': 2,
	'strings-bass': 3,
	'synth': 4,
	'woodwind': 1,
}

/**
 * Geometry of each row. y centers are placed on the stage floor at
 * fractions of `stageRadiusY` from the floor center (negative = toward
 * audience). x extents are similarly derived from `stageRadiusX` so the
 * whole row layout scales with the floor.
 *
 * `maxX` is the horizontal half-extent for the "ideal" performer count;
 * rows that exceed `defaultSlots` widen up to `maxAbsX` before they start
 * zig-zagging in y to stay on the stage.
 *
 * `arcDepth` makes each row follow the circular stage's curvature: the
 * row's center sits closest to the audience and the edges curve back
 * toward the rear of the stage, exactly like musicians standing on a
 * round revue stage seen from above.
 */
const rowGeometry: Record<StageRow, {
	arcDepth: number
	defaultSlots: number
	maxAbsX: number
	maxX: number
	yCenter: number
	zigzagY: number
}> = {
	back: {
		arcDepth: stageRadiusY * 0.13, // ≈ 0.17
		defaultSlots: 2,
		maxAbsX: stageRadiusX * 0.55, // ≈ 1.23
		maxX: stageRadiusX * 0.40, // ≈ 0.89
		yCenter: stageCenter.y + stageRadiusY * 0.87, // ≈  0.56
		zigzagY: stageRadiusY * 0.07,
	},
	front: {
		arcDepth: stageRadiusY * 0.35, // ≈ 0.44 — strongest arc, widest row
		defaultSlots: 5,
		maxAbsX: stageRadiusX * 0.95, // ≈ 2.12
		maxX: stageRadiusX * 0.78, // ≈ 1.74
		yCenter: stageCenter.y - stageRadiusY * 0.32, // ≈ -0.96
		zigzagY: stageRadiusY * 0.13,
	},
	middle: {
		arcDepth: stageRadiusY * 0.28, // ≈ 0.36
		defaultSlots: 4,
		maxAbsX: stageRadiusX * 0.80, // ≈ 1.78
		maxX: stageRadiusX * 0.62, // ≈ 1.38
		yCenter: stageCenter.y + stageRadiusY * 0.28, // ≈ -0.19
		zigzagY: stageRadiusY * 0.09,
	},
}

const rowOrder: StageRow[] = ['back', 'middle', 'front']

export function classifySection(performer: Performer): OrchestraSection {
	return categoryToSection[performer.category] ?? 'other'
}

/** Strings: violins (lowest program) on stage left, then violas → cellos → contrabass on the right. */
function stringsOrder(performer: Performer): number {
	let lowest = Number.POSITIVE_INFINITY
	for (const track of performer.tracks) {
		if (track.program < lowest) {
			lowest = track.program
		}
	}
	return Number.isFinite(lowest) ? lowest : 0
}

/**
 * Compute placements for every performer. Sections cluster into their row
 * (strings/keyboard/guitar in front, brass/woodwind/synth in middle, drums
 * in back) and inside each row performers are spread evenly along an
 * elliptical arc — so the historical front/back/section grouping is
 * preserved but adapts to any performer count.
 */
export function layoutOrchestra(performers: Performer[]): Map<string, StagePlacement> {
	const rows: Record<StageRow, Array<{ performer: Performer, section: OrchestraSection }>> = {
		back: [],
		front: [],
		middle: [],
	}

	for (const performer of performers) {
		const section = classifySection(performer)
		rows[sectionRow[section]].push({ performer, section })
	}

	for (const row of rowOrder) {
		rows[row].sort((a, b) => {
			const delta = sectionOrderInRow[a.section] - sectionOrderInRow[b.section]
			if (delta !== 0) {
				return delta
			}
			if (a.section === 'strings' && b.section === 'strings') {
				return stringsOrder(a.performer) - stringsOrder(b.performer)
			}
			return a.performer.name.localeCompare(b.performer.name)
		})
	}

	const placements = new Map<string, StagePlacement>()

	for (const row of rowOrder) {
		const list = rows[row]
		const n = list.length
		if (n === 0) {
			continue
		}

		const { arcDepth, defaultSlots, maxAbsX, maxX, yCenter, zigzagY } = rowGeometry[row]
		// Stretch the row's horizontal extent as performers are added so they
		// stay on stage, capped at `maxAbsX` to avoid spilling into the wings.
		const targetExtent = MathUtils.clamp(
			maxX * (n / defaultSlots),
			Math.min(maxX, 0.001),
			maxAbsX,
		)
		const useZigzag = n > defaultSlots

		for (let i = 0; i < n; i += 1) {
			const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1
			const x = t * targetExtent
			// Arc the row backward at the edges so it traces the round stage:
			// y at the center is closest to the audience, y at the edges
			// curves toward the rear (higher y = further upstage).
			const y = yCenter + arcDepth * t * t
			const zigzagOffset = useZigzag && i % 2 === 1 ? zigzagY : 0

			placements.set(list[i]!.performer.id, placementForSlot({ x, y: y + zigzagOffset }, list[i]!.section))
		}
	}

	return placements
}

/**
 * Sprite scale based on y depth. y small → front → bigger; y large →
 * back → smaller. Range is clamped to the configured min/max scale.
 */
export function depthScale(y: number): number {
	const normalized = MathUtils.clamp(
		(y - minPlacementY) / (maxPlacementY - minPlacementY),
		0,
		1,
	)
	return MathUtils.lerp(minDepthScale, maxDepthScale, 1 - normalized)
}

/**
 * Maps the performer's y to the z used for draw order. Front-row sprites
 * (smaller y) get a larger z so they paint on top of back-row sprites.
 */
export function depthZ(y: number): number {
	const normalized = MathUtils.clamp(
		(y - minPlacementY) / (maxPlacementY - minPlacementY),
		0,
		1,
	)
	return MathUtils.lerp(maxDepthZ, minDepthZ, normalized)
}

function placementForSlot(slot: { x: number, y: number }, section: OrchestraSection): StagePlacement {
	const z = depthZ(slot.y)
	return {
		position: [slot.x, slot.y, z],
		// Pair renderOrder with z so transparent sprites still paint in the
		// right order even when depth testing is disabled on their material.
		renderOrder: Math.round(z * 100),
		scale: depthScale(slot.y),
		section,
	}
}
