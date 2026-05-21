import type { OrchestraSection, SectionFrame, StagePlacement } from './orchestra-layout'

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'

import { sectionFrames } from './orchestra-layout'

type ShotName
	= | 'crane'
		| 'master-low'
		| 'master-wide'
		| 'section-spotlight'
		| 'solo'
		| 'sweep'

interface DirectorProps {
	activeNotes: Map<string, number>
	focusedId: null | string
	isPlaying: boolean
	placements: Map<string, StagePlacement>
	stageReach: number
}

interface Shot {
	look: [number, number, number]
	pos: [number, number, number]
}

interface ShotContext {
	activeNotes: Map<string, number>
	focusedId: null | string
	frames: Map<OrchestraSection, SectionFrame>
	hotSectionChangedAtRef: { current: number }
	hotSectionRef: { current: null | OrchestraSection }
	placements: Map<string, StagePlacement>
	stageReach: number
	t: number
}

const playingRotation: ShotName[] = [
	'master-wide',
	'section-spotlight',
	'solo',
	'sweep',
	'master-low',
	'crane',
	'section-spotlight',
]

const shotDuration: Record<ShotName, number> = {
	'crane': 5,
	'master-low': 5.5,
	'master-wide': 6.5,
	'section-spotlight': 5.2,
	'solo': 5,
	'sweep': 7,
}

const focusVec = new Vector3()
const targetVec = new Vector3()
const hotSectionHoldSeconds = 2.4

export function DirectorCamera({ activeNotes, focusedId, isPlaying, placements, stageReach }: DirectorProps) {
	const frames = useMemo(() => sectionFrames(placements), [placements])
	const lookRef = useRef(new Vector3(0, -0.2, -0.4))
	const shotIndexRef = useRef(0)
	const shotStartedAtRef = useRef(0)
	const currentShotRef = useRef<ShotName>('master-wide')
	const overrideShotRef = useRef<null | ShotName>(null)
	const hotSectionChangedAtRef = useRef(0)
	const hotSectionRef = useRef<null | OrchestraSection>(null)
	const lastFocusRef = useRef<null | string>(focusedId)

	useEffect(() => {
		if (lastFocusRef.current !== focusedId) {
			overrideShotRef.current = focusedId ? 'solo' : 'master-wide'
			lastFocusRef.current = focusedId
		}
	}, [focusedId])

	useEffect(() => {
		if (!isPlaying) {
			overrideShotRef.current = 'master-wide'
		}
	}, [isPlaying])

	useFrame((state, dt) => {
		const t = state.clock.elapsedTime

		if (overrideShotRef.current) {
			currentShotRef.current = overrideShotRef.current
			shotStartedAtRef.current = t
			shotIndexRef.current = Math.max(playingRotation.indexOf(currentShotRef.current), 0)
			overrideShotRef.current = null
		}

		if (focusedId) {
			currentShotRef.current = 'solo'
			shotStartedAtRef.current = t
		}

		const elapsed = t - shotStartedAtRef.current
		if (!focusedId && isPlaying && elapsed >= shotDuration[currentShotRef.current]) {
			shotIndexRef.current = (shotIndexRef.current + 1) % playingRotation.length
			currentShotRef.current = playingRotation[shotIndexRef.current]!
			shotStartedAtRef.current = t
		}

		const ctx: ShotContext = {
			activeNotes,
			focusedId,
			frames,
			hotSectionChangedAtRef,
			hotSectionRef,
			placements,
			stageReach,
			t,
		}

		const shot = computeShot(currentShotRef.current, ctx)
		const followStrength = currentShotRef.current === 'sweep' ? 1.6 : 2.2
		const ease = 1 - Math.exp(-dt * followStrength)
		targetVec.set(shot.pos[0], shot.pos[1], shot.pos[2])
		focusVec.set(shot.look[0], shot.look[1], shot.look[2])
		state.camera.position.lerp(targetVec, ease)
		lookRef.current.lerp(focusVec, ease)
		state.camera.lookAt(lookRef.current)
	})

	return null
}

function computeShot(name: ShotName, ctx: ShotContext): Shot {
	switch (name) {
		case 'master-wide':
			return masterWide(ctx)
		case 'master-low':
			return masterLow(ctx)
		case 'section-spotlight':
			return sectionSpotlight(ctx)
		case 'solo':
			return soloShot(ctx)
		case 'sweep':
			return sweepShot(ctx)
		case 'crane':
			return craneShot(ctx)
	}
}

function masterWide({ stageReach }: ShotContext): Shot {
	return {
		look: [0, 0.05, -0.8],
		pos: [0, stageReach * 0.5 + 1.4, stageReach + 7.2],
	}
}

function masterLow({ stageReach, t }: ShotContext): Shot {
	const drift = Math.sin(t * 0.12) * stageReach * 0.18
	return {
		look: [drift * 0.4, 0.1, -0.5],
		pos: [drift, 2.2, stageReach + 4.5],
	}
}

function sectionSpotlight(ctx: ShotContext): Shot {
	const section = pickHotSection(ctx)
	const frame = section ? ctx.frames.get(section) : undefined
	if (!frame) {
		return masterWide(ctx)
	}

	const width = Math.max(frame.maxX - frame.minX, 1.6)
	const distance = Math.max(width * 1.1 + 4.2, 5.4)
	const isBack = section === 'percussion' || section === 'brass' || section === 'synth' || section === 'woodwind'
	const height = isBack ? 2.5 : 1.9
	const lookY = isBack ? 0.25 : -0.05

	return {
		look: [frame.x, lookY, frame.z],
		pos: [frame.x * 0.45, height, frame.z + distance],
	}
}

function soloShot(ctx: ShotContext): Shot {
	if (!ctx.focusedId) {
		return masterWide(ctx)
	}
	const placement = ctx.placements.get(ctx.focusedId)
	if (!placement) {
		return masterWide(ctx)
	}
	const [x, y, z] = placement.position
	const orbit = Math.sin(ctx.t * 0.35) * 0.55
	return {
		look: [x, y + 0.4, z],
		pos: [x * 0.55 + orbit, y + 1.45, z + 3.8],
	}
}

function sweepShot({ stageReach, t }: ShotContext): Shot {
	const reach = stageReach
	const pan = Math.sin(t * 0.22) * reach * 0.55
	return {
		look: [pan * 0.35, 0.05, -0.5],
		pos: [pan, 2.05, reach + 4.8],
	}
}

function craneShot({ stageReach }: ShotContext): Shot {
	return {
		look: [0, -0.15, -1.1],
		pos: [0, stageReach * 0.62 + 1.4, stageReach + 4.2],
	}
}

function pickHotSection(ctx: ShotContext): null | OrchestraSection {
	const counts = new Map<OrchestraSection, number>()
	for (const [id, intensity] of ctx.activeNotes) {
		if (intensity <= 0) {
			continue
		}
		const section = ctx.placements.get(id)?.section
		if (section) {
			counts.set(section, (counts.get(section) ?? 0) + 1)
		}
	}

	let best: null | OrchestraSection = null
	let bestCount = 0
	for (const [section, count] of counts) {
		if (count > bestCount) {
			best = section
			bestCount = count
		}
	}

	if (best) {
		if (ctx.hotSectionRef.current && ctx.hotSectionRef.current !== best && ctx.t - ctx.hotSectionChangedAtRef.current < hotSectionHoldSeconds) {
			return ctx.hotSectionRef.current
		}
		if (ctx.hotSectionRef.current !== best) {
			ctx.hotSectionChangedAtRef.current = ctx.t
		}
		ctx.hotSectionRef.current = best
		return best
	}

	if (ctx.hotSectionRef.current) {
		return ctx.hotSectionRef.current
	}

	return ctx.focusedId ? (ctx.placements.get(ctx.focusedId)?.section ?? null) : null
}
