import type { Points } from 'three'

import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color } from 'three'

interface StageLightsProps {
	isPlaying: boolean
}

const dustCount = 120
const dustWidth = 11
const dustHeight = 4.8
const dustDepth = 4.2

export function StageLights({ isPlaying }: StageLightsProps) {
	const dustRef = useRef<Points>(null)
	const beamTexture = useMemo(makeBeamTexture, [])
	const dustTexture = useMemo(makeDustTexture, [])
	const dust = useMemo(makeDustGeometry, [])
	const beamOpacity = isPlaying ? 0.3 : 0.18
	const dustOpacity = isPlaying ? 0.26 : 0.14

	useFrame(({ clock }, dt) => {
		const points = dustRef.current
		if (!points) {
			return
		}

		const positions = points.geometry.getAttribute('position') as BufferAttribute
		const seeds = dust.seeds
		const speed = isPlaying ? 0.16 : 0.055
		const t = clock.elapsedTime

		for (let i = 0; i < dustCount; i += 1) {
			const base = i * 3
			let y = positions.getY(i) + dt * speed * (0.55 + seeds[i]! * 0.7)
			if (y > dustHeight) {
				y = 0.6
			}

			const x = dust.origins[base]! + Math.sin(t * 0.22 + seeds[i]! * 8) * 0.08
			const z = dust.origins[base + 2]! + Math.cos(t * 0.18 + seeds[i]! * 7) * 0.06
			positions.setXYZ(i, x, y, z)
		}

		positions.needsUpdate = true
	})

	return (
		<group renderOrder={-2}>
			<Beam color="#ffcf70" opacity={beamOpacity} position={[-3.6, 2.8, -2.8]} rotation={[0.16, 0, -0.42]} texture={beamTexture} />
			<Beam color="#75d7c4" opacity={beamOpacity * 0.78} position={[3.7, 2.7, -2.6]} rotation={[0.14, 0, 0.38]} texture={beamTexture} />
			<Beam color="#fff8e7" opacity={beamOpacity * 0.44} position={[0, 2.6, -3.1]} rotation={[0.08, 0, 0]} texture={beamTexture} />
			<points geometry={dust.geometry} ref={dustRef} renderOrder={-1}>
				<pointsMaterial
					blending={AdditiveBlending}
					color="#fff8e7"
					depthWrite={false}
					map={dustTexture}
					opacity={dustOpacity}
					size={0.12}
					sizeAttenuation
					transparent
				/>
			</points>
		</group>
	)
}

function Beam({
	color,
	opacity,
	position,
	rotation,
	texture,
}: {
	color: string
	opacity: number
	position: [number, number, number]
	rotation: [number, number, number]
	texture: CanvasTexture
}) {
	return (
		<mesh position={position} renderOrder={-2} rotation={rotation}>
			<planeGeometry args={[2.1, 7.2]} />
			<meshBasicMaterial
				blending={AdditiveBlending}
				color={new Color(color)}
				depthWrite={false}
				map={texture}
				opacity={opacity}
				transparent
			/>
		</mesh>
	)
}

function makeBeamTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 256
	canvas.height = 1024
	const ctx = canvas.getContext('2d')!
	const image = ctx.createImageData(canvas.width, canvas.height)

	for (let y = 0; y < canvas.height; y += 1) {
		const v = y / (canvas.height - 1)
		const lengthFade = Math.max(0, 1 - v ** 1.8)
		for (let x = 0; x < canvas.width; x += 1) {
			const u = Math.abs((x / (canvas.width - 1)) * 2 - 1)
			const softEdge = Math.max(0, 1 - u ** 2.8)
			const alpha = Math.round(255 * softEdge * lengthFade)
			const index = (y * canvas.width + x) * 4
			image.data[index] = 255
			image.data[index + 1] = 255
			image.data[index + 2] = 255
			image.data[index + 3] = alpha
		}
	}

	ctx.putImageData(image, 0, 0)
	const texture = new CanvasTexture(canvas)
	texture.needsUpdate = true
	return texture
}

function makeDustTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 64
	canvas.height = 64
	const ctx = canvas.getContext('2d')!
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
	gradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)')
	gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)')
	gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
	ctx.fillStyle = gradient
	ctx.fillRect(0, 0, canvas.width, canvas.height)
	const texture = new CanvasTexture(canvas)
	texture.needsUpdate = true
	return texture
}

function makeDustGeometry() {
	const positions = new Float32Array(dustCount * 3)
	const origins = new Float32Array(dustCount * 3)
	const seeds = new Float32Array(dustCount)

	for (let i = 0; i < dustCount; i += 1) {
		const x = (Math.random() - 0.5) * dustWidth
		const y = 0.6 + Math.random() * (dustHeight - 0.6)
		const z = -4.2 + Math.random() * dustDepth
		const base = i * 3
		positions[base] = x
		positions[base + 1] = y
		positions[base + 2] = z
		origins[base] = x
		origins[base + 1] = y
		origins[base + 2] = z
		seeds[i] = Math.random()
	}

	const geometry = new BufferGeometry()
	geometry.setAttribute('position', new BufferAttribute(positions, 3))
	return { geometry, origins, seeds }
}
