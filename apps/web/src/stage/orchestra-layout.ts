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
	/** Y rotation (radians), facing the audience camera. */
	rotationY: number
	section: OrchestraSection
}

/** Performer plane is 1.24 wide; keep at least this much breathing room between models. */
const minSpacing = 1.85
const maxSpacing = 2.55
const sectionGap = 0.75

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

/** Row depth: +Z = front (closer to camera / audience). */
const rowDepth: Record<StageRow, number> = {
	back: -3.2,
	front: 0.9,
	middle: -1.15,
}

const rowOrder: StageRow[] = ['front', 'middle', 'back']

const sectionLayout: Record<OrchestraSection, { order: number, row: StageRow, xSpread: number, yLift: number }> = {
	'brass': { order: 2, row: 'middle', xSpread: 3.7, yLift: 0.5 },
	'guitar': { order: 1, row: 'front', xSpread: 1.9, yLift: 0 },
	'keyboard': { order: 0, row: 'front', xSpread: 2.1, yLift: 0.05 },
	'other': { order: 3, row: 'middle', xSpread: 2.6, yLift: 0.1 },
	'percussion': { order: 0, row: 'back', xSpread: 3.2, yLift: 0.95 },
	'strings': { order: 2, row: 'front', xSpread: 5.4, yLift: 0 },
	'strings-bass': { order: 3, row: 'front', xSpread: 2.2, yLift: 0.05 },
	'synth': { order: 4, row: 'middle', xSpread: 2.4, yLift: 0.42 },
	'woodwind': { order: 1, row: 'middle', xSpread: 4.3, yLift: 0.32 },
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

export function layoutOrchestra(performers: Performer[]): Map<string, StagePlacement> {
	const bySection = new Map<OrchestraSection, Performer[]>()

	for (const section of sectionOrder) {
		bySection.set(section, [])
	}

	for (const performer of performers) {
		const section = classifySection(performer)
		bySection.get(section)!.push(performer)
	}

	const placements = new Map<string, StagePlacement>()

	for (const row of rowOrder) {
		const rowSections = sectionOrder
			.filter(section => sectionLayout[section].row === row && bySection.get(section)!.length > 0)
			.sort((a, b) => sectionLayout[a].order - sectionLayout[b].order)
		if (rowSections.length === 0) {
			continue
		}

		const widths = rowSections.map((section) => {
			const count = bySection.get(section)!.length
			const layout = sectionLayout[section]
			const preferred = count > 1 ? layout.xSpread / (count - 1) : 0
			const spacing = count > 1 ? Math.min(Math.max(preferred, minSpacing), maxSpacing) : 0
			return Math.max((count - 1) * spacing, 1.25)
		})
		const totalWidth = widths.reduce((sum, width) => sum + width, 0) + sectionGap * (rowSections.length - 1)
		let cursor = -totalWidth / 2

		for (const [sectionIndex, section] of rowSections.entries()) {
			const group = bySection.get(section)!
			if (section === 'strings') {
				group.sort((a, b) => stringsOrder(a) - stringsOrder(b))
			}

			const width = widths[sectionIndex]!
			const sectionCenter = cursor + width / 2
			const { xSpread, yLift } = sectionLayout[section]
			const count = group.length
			const preferred = count > 1 ? xSpread / (count - 1) : 0
			const spacing = count > 1 ? Math.min(Math.max(preferred, minSpacing), maxSpacing) : 0
			const halfWidth = ((count - 1) * spacing) / 2
			const arcDepth = row === 'front' ? 0.12 : 0.28

			for (const [index, performer] of group.entries()) {
				const offset = (index - (count - 1) / 2) * spacing
				const arc = halfWidth > 0 ? (offset / halfWidth) ** 2 * arcDepth : 0
				const x = sectionCenter + offset
				const z = rowDepth[row] - arc
				const y = -0.62 + yLift
				const position: [number, number, number] = [x, y, z]
				placements.set(performer.id, {
					position,
					rotationY: 0,
					section,
				})
			}

			cursor += width + sectionGap
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
