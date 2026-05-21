import type { InstrumentCategory } from '../instrument-category'
import type { Performer } from '../song'

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

export interface StagePlacement {
	position: [number, number, number]
	/**
	 * Draw order for 2D sprites on the same z plane. Higher = paints later =
	 * visually in front. Back rows use lower values so front rows always paint
	 * on top without z-fighting.
	 */
	renderOrder: number
	/** Y rotation (radians), facing the audience camera. */
	rotationY: number
	section: OrchestraSection
}

/**
 * The character plane is `characterPlaneWidth` wide. Adjacent characters need
 * at least `noOverlapSpacing` apart in x to avoid visible overlap; below that
 * we switch to a brick pattern (alternating sub-rows) so the row can fit
 * twice as many performers in the same horizontal budget.
 */
const characterPlaneWidth = 1.7
const noOverlapSpacing = characterPlaneWidth + 0.2
const preferredSpacing = 2.2
const maxSpacing = 2.8

export const stageFloorTiltRadians = 0.16

const stageFrontZ = 1.1
const stageFrontY = -1.94
const stageSlopeYPerZ = 0.16

export function stageSurfaceY(z: number): number {
	return stageFrontY + (stageFrontZ - z) * stageSlopeYPerZ
}

/** Use 92% of viewport width so characters never hug the edges. */
const widthBudget = 0.92

const sectionOrder: OrchestraSection[] = [
	'strings',
	'strings-bass',
	'woodwind',
	'brass',
	'keyboard',
	'guitar',
	'percussion',
	'synth',
	'other',
]

type StageRow = 'back' | 'front' | 'middle'

const rowDepth: Record<StageRow, number> = {
	back: -2,
	front: 1.12,
	middle: -0.48,
}

const rowSpacingScale: Record<StageRow, number> = {
	back: 1.08,
	front: 0.82,
	middle: 0.9,
}

const rowOrder: StageRow[] = ['front', 'middle', 'back']

const rowRenderBase: Record<StageRow, number> = {
	back: 0,
	front: 40,
	middle: 20,
}

const sectionLayout: Record<OrchestraSection, { order: number, row: StageRow, yLift: number }> = {
	'brass': { order: 2, row: 'middle', yLift: 0.28 },
	'guitar': { order: 1, row: 'front', yLift: 0 },
	'keyboard': { order: 0, row: 'front', yLift: 0.05 },
	'other': { order: 3, row: 'middle', yLift: 0.1 },
	'percussion': { order: 0, row: 'back', yLift: 0.12 },
	'strings': { order: 2, row: 'front', yLift: 0 },
	'strings-bass': { order: 3, row: 'front', yLift: 0.05 },
	'synth': { order: 4, row: 'middle', yLift: 0.24 },
	'woodwind': { order: 1, row: 'middle', yLift: 0.2 },
}

export function classifySection(performer: Performer): OrchestraSection {
	return categoryToSection[performer.category] ?? 'other'
}

/** Strings: violins (lowest program in track set) → cellos / contrabass right. */
function stringsOrder(performer: Performer): number {
	let lowest = Number.POSITIVE_INFINITY
	for (const track of performer.tracks) {
		if (track.program < lowest) {
			lowest = track.program
		}
	}
	if (!Number.isFinite(lowest)) {
		return 0
	}
	if (lowest <= 41) {
		return 0
	}
	if (lowest === 42) {
		return 1
	}
	if (lowest === 43) {
		return 2
	}
	return lowest
}

/**
 * Compute world-space placements for every performer.
 *
 * The layout is viewport-aware: spacing inside each stage row stretches up to
 * `maxSpacing` when there is room and shrinks down to `noOverlapSpacing` when
 * crowded. Once spacing would dip below the no-overlap threshold, the row
 * switches to a brick (zig-zag) pattern so alternating performers staircase
 * back/forth in y while keeping their horizontal slots uniform.
 *
 * @param performers The performers to lay out.
 * @param viewportWorldWidth Stable world width for the stage layout. Keep this
 *   based on canvas aspect/resize, not the live camera viewport, so director
 *   camera moves never reshuffle performer positions.
 */
export function layoutOrchestra(
	performers: Performer[],
	viewportWorldWidth = 14,
): Map<string, StagePlacement> {
	const bySection = new Map<OrchestraSection, Performer[]>()

	for (const section of sectionOrder) {
		bySection.set(section, [])
	}

	for (const performer of performers) {
		const section = classifySection(performer)
		bySection.get(section)!.push(performer)
	}

	// Total width budget for the row, edge-to-edge. The visible character
	// spans from `centerX - characterPlaneWidth / 2` to `centerX + characterPlaneWidth / 2`,
	// so subtract one full plane width to leave room for the half-plane that
	// extends past each outermost slot center.
	const usableEdgeToEdge = Math.max(viewportWorldWidth * widthBudget - characterPlaneWidth, noOverlapSpacing * 2)
	const placements = new Map<string, StagePlacement>()

	for (const row of rowOrder) {
		const rowSections = sectionOrder
			.filter(section => sectionLayout[section].row === row && bySection.get(section)!.length > 0)
			.sort((a, b) => sectionLayout[a].order - sectionLayout[b].order)
		if (rowSections.length === 0) {
			continue
		}

		const rowList: Array<{ performer: Performer, section: OrchestraSection }> = []
		for (const section of rowSections) {
			const group = bySection.get(section)!.slice()
			if (section === 'strings') {
				group.sort((a, b) => stringsOrder(a) - stringsOrder(b))
			}
			for (const performer of group) {
				rowList.push({ performer, section })
			}
		}

		const slots = Math.max(rowList.length - 1, 0)
		let spacing = preferredSpacing
		if (slots > 0) {
			spacing = Math.min(maxSpacing, usableEdgeToEdge / slots)
		}

		// Brick mode kicks in once the row can't fit at the no-overlap
		// threshold. The pattern doubles row capacity at the cost of a tiny
		// vertical stagger.
		const useBrick = slots > 0 && spacing < noOverlapSpacing
		if (useBrick) {
			spacing = noOverlapSpacing
		}

		// Equal world-space spacing does not look equal through the perspective
		// camera: closer rows read wider. Nudge each row so screen-space gaps
		// feel consistent across the stage.
		spacing *= rowSpacingScale[row]

		const totalWidth = slots * spacing

		for (const [index, item] of rowList.entries()) {
			const subRowIndex = useBrick ? index % 2 : 0
			const x = -totalWidth / 2 + index * spacing
			// Brick offset lifts the second sub-row enough that its head pokes
			// clearly above the front sub-row's head instead of being half-eaten.
			const yBrickOffset = subRowIndex * 0.46
			const yLift = sectionLayout[item.section].yLift
			const depth = rowDepth[row]
			const y = stageSurfaceY(depth) + characterPlaneWidth / 2 + yLift * 0.18 + yBrickOffset

			placements.set(item.performer.id, {
				position: [x, y, depth],
				// Even-indexed performers paint after odd-indexed ones so the
				// front sub-row covers the back one cleanly. We still bias by
				// stage row so e.g. front-row characters never get painted
				// under back-row characters even when both rows use brick.
				renderOrder: rowRenderBase[row] + (1 - subRowIndex) * 10 + index,
				rotationY: 0,
				section: item.section,
			})
		}
	}

	return placements
}

export function stageRadius(placements: Map<string, StagePlacement>): number {
	let maxReach = 6
	for (const { position } of placements.values()) {
		const reach = Math.hypot(position[0], position[2] - 0.3)
		maxReach = Math.max(maxReach, reach + 1.8)
	}
	return Math.min(maxReach, 12)
}

export interface SectionFrame {
	count: number
	maxX: number
	maxZ: number
	minX: number
	minZ: number
	x: number
	z: number
}

export function sectionFrames(placements: Map<string, StagePlacement>): Map<OrchestraSection, SectionFrame> {
	const map = new Map<OrchestraSection, SectionFrame>()
	for (const { position, section } of placements.values()) {
		const [x, , z] = position
		const cur = map.get(section)
		if (cur) {
			cur.x += x
			cur.z += z
			cur.count += 1
			cur.minX = Math.min(cur.minX, x)
			cur.maxX = Math.max(cur.maxX, x)
			cur.minZ = Math.min(cur.minZ, z)
			cur.maxZ = Math.max(cur.maxZ, z)
		}
		else {
			map.set(section, { count: 1, maxX: x, maxZ: z, minX: x, minZ: z, x, z })
		}
	}
	for (const frame of map.values()) {
		frame.x /= frame.count
		frame.z /= frame.count
	}
	return map
}
