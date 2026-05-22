import type { Sprite } from 'three'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CanvasTexture } from 'three'

const glyphs = ['♪', '♫', '♩', '♬']

const SLOT_COUNT = 3
const LIFETIME = 1.35
const SPAWN_INTERVAL = 0.5

interface Slot {
	glyph: number
	id: string
	seed: number
	spawnAt: number
}

let sharedTextures: CanvasTexture[] | null = null

function getGlyphTextures(): CanvasTexture[] {
	if (sharedTextures) {
		return sharedTextures
	}
	sharedTextures = glyphs.map(makeGlyphTexture)
	return sharedTextures
}

function makeGlyphTexture(glyph: string): CanvasTexture {
	const canvas = document.createElement('canvas')
	canvas.width = 128
	canvas.height = 128
	const ctx = canvas.getContext('2d')!
	ctx.font = 'bold 92px "Segoe UI Symbol", "Apple Symbols", "DejaVu Sans", sans-serif'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
	ctx.shadowBlur = 12
	ctx.shadowOffsetY = 2
	ctx.fillStyle = '#ffffff'
	ctx.fillText(glyph, 64, 70)
	const texture = new CanvasTexture(canvas)
	texture.needsUpdate = true
	return texture
}

export function FloatingNotes({
	accent,
	active,
	isPlaying,
	origin = { x: 0, y: 0.95 },
	renderOrder = 0,
}: {
	accent: string
	active: number
	isPlaying: boolean
	origin?: { x: number, y: number }
	renderOrder?: number
}) {
	const textures = useMemo(getGlyphTextures, [])
	const slotsRef = useRef<Slot[]>(
		Array.from({ length: SLOT_COUNT }, (_, index) => ({
			glyph: 0,
			id: `floating-note-${index}`,
			seed: Math.random() * 6.28,
			spawnAt: -10,
		})),
	)
	const nextSlotRef = useRef(0)
	const lastSpawnRef = useRef(-10)
	const spritesRef = useRef<Array<null | Sprite>>(
		Array.from<null | Sprite>({ length: SLOT_COUNT }).fill(null),
	)

	useFrame(({ clock }) => {
		const now = clock.elapsedTime

		if (active > 0 && isPlaying && now - lastSpawnRef.current > SPAWN_INTERVAL) {
			const slotIndex = nextSlotRef.current
			const glyph = Math.floor(Math.random() * textures.length)
			slotsRef.current[slotIndex] = {
				glyph,
				id: slotsRef.current[slotIndex]!.id,
				seed: Math.random() * 6.28,
				spawnAt: now,
			}

			const sprite = spritesRef.current[slotIndex]
			if (sprite) {
				sprite.material.map = textures[glyph] ?? null
				sprite.material.needsUpdate = true
			}

			nextSlotRef.current = (slotIndex + 1) % SLOT_COUNT
			lastSpawnRef.current = now
		}

		for (let i = 0; i < SLOT_COUNT; i += 1) {
			const sprite = spritesRef.current[i]
			const slot = slotsRef.current[i]!
			if (!sprite) {
				continue
			}

			const age = now - slot.spawnAt
			if (age < 0 || age > LIFETIME) {
				sprite.visible = false
				continue
			}

			sprite.visible = true
			const k = age / LIFETIME
			const drift = Math.sin(slot.seed + age * 2.4) * 0.34
			const lift = origin.y + k * 1.1
			sprite.position.set(origin.x + drift, lift, 0.05)
			const scale = 0.32 * (0.65 + 0.35 * (1 - k))
			sprite.scale.set(scale, scale, 1)
			sprite.material.rotation = Math.sin(slot.seed + age * 3) * 0.4
			const fadeIn = k < 0.14 ? k / 0.14 : 1
			const fadeOut = 1 - (k - 0.2 < 0 ? 0 : ((k - 0.2) / 0.8) ** 1.6)
			sprite.material.opacity = Math.max(0, fadeIn * fadeOut * 0.72)
		}
	})

	return (
		<>
			{slotsRef.current.map((slot, i) => (
				<sprite
					ref={(value) => {
						spritesRef.current[i] = value
					}}
					key={slot.id}
					renderOrder={renderOrder}
					visible={false}
				>
					<spriteMaterial color={accent} depthWrite={false} transparent />
				</sprite>
			))}
		</>
	)
}
