import { useEffect, useMemo } from 'react'
import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'

import { stageFloorTiltRadians } from './orchestra-layout'
import { StageLights } from './stage-lights'

interface StageEnvironmentProps {
	isPlaying: boolean
}

interface AnimeStageTextures {
	backdrop: CanvasTexture
	floor: CanvasTexture
}

export function StageEnvironment({ isPlaying }: StageEnvironmentProps) {
	const textures = useMemo(makeAnimeStageTextures, [])

	useEffect(() => () => {
		textures.backdrop.dispose()
		textures.floor.dispose()
	}, [textures])

	return (
		<group>
			<mesh position={[0, 0.7, -7.35]} renderOrder={-8}>
				<planeGeometry args={[18.4, 10.2]} />
				<meshBasicMaterial depthWrite={false} map={textures.backdrop} toneMapped={false} />
			</mesh>

			<mesh position={[0, -1.94, -1.3]} rotation={[-Math.PI / 2 + stageFloorTiltRadians, 0, 0]}>
				<planeGeometry args={[18, 12]} />
				<meshBasicMaterial map={textures.floor} toneMapped={false} />
			</mesh>

			<StageLights isPlaying={isPlaying} />
		</group>
	)
}

function makeAnimeStageTextures(): AnimeStageTextures {
	return {
		backdrop: makeAnimeBackdropTexture(),
		floor: makeAnimeFloorTexture(),
	}
}

function makeAnimeBackdropTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 1280
	canvas.height = 720
	const context = canvas.getContext('2d')!

	const sky = context.createLinearGradient(0, 0, 0, canvas.height)
	sky.addColorStop(0, '#4e4f7d')
	sky.addColorStop(0.46, '#353859')
	sky.addColorStop(1, '#24243b')
	context.fillStyle = sky
	context.fillRect(0, 0, canvas.width, canvas.height)

	drawBackdropPanel(context, 58, 64, 326, 596, '#be7a68')
	drawBackdropPanel(context, 896, 64, 326, 596, '#be7a68')
	drawBackdropPanel(context, 402, 84, 476, 538, '#303254')

	drawSpotGlow(context, 360, -40, '#ffe18e')
	drawSpotGlow(context, 640, -28, '#e4e8ff')
	drawSpotGlow(context, 920, -40, '#8fe7df')

	context.fillStyle = 'rgba(12, 13, 29, 0.16)'
	for (let i = 0; i < 44; i += 1) {
		const x = seededNoise(i, 1) * canvas.width
		const y = 95 + seededNoise(i, 2) * 510
		const size = 1.8 + seededNoise(i, 3) * 3.2
		context.beginPath()
		context.arc(x, y, size, 0, Math.PI * 2)
		context.fill()
	}

	drawInkLine(context, [
		[56, 64],
		[386, 64],
		[386, 662],
		[56, 662],
		[56, 64],
	], 10, 'rgba(18, 17, 29, 0.76)')
	drawInkLine(context, [
		[894, 64],
		[1224, 64],
		[1224, 662],
		[894, 662],
		[894, 64],
	], 10, 'rgba(18, 17, 29, 0.76)')
	drawInkLine(context, [
		[400, 84],
		[880, 84],
		[880, 622],
		[400, 622],
		[400, 84],
	], 9, 'rgba(18, 17, 29, 0.62)')

	const texture = new CanvasTexture(canvas)
	texture.colorSpace = SRGBColorSpace
	texture.minFilter = LinearFilter
	texture.magFilter = LinearFilter
	texture.needsUpdate = true
	return texture
}

function makeAnimeFloorTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 1024
	canvas.height = 1024
	const context = canvas.getContext('2d')!
	const base = context.createLinearGradient(0, 0, 0, canvas.height)
	base.addColorStop(0, '#e7a66f')
	base.addColorStop(0.5, '#c77f55')
	base.addColorStop(1, '#8d553f')
	context.fillStyle = base
	context.fillRect(0, 0, canvas.width, canvas.height)

	for (let plank = 0; plank < 10; plank += 1) {
		const x = (plank / 10) * canvas.width
		context.fillStyle = plank % 2 === 0 ? 'rgba(255, 229, 164, 0.2)' : 'rgba(98, 53, 46, 0.14)'
		context.fillRect(x, 0, canvas.width / 10, canvas.height)
		drawInkLine(context, [[x, 0], [x, canvas.height]], 7, 'rgba(48, 31, 35, 0.58)')
	}

	for (let stripe = 0; stripe < 9; stripe += 1) {
		const y = (stripe / 9) * canvas.height
		drawInkLine(context, [[0, y], [canvas.width, y]], 5, 'rgba(48, 31, 35, 0.35)')
	}

	for (let grain = 0; grain < 42; grain += 1) {
		const y = seededNoise(grain, 12) * canvas.height
		context.strokeStyle = `rgba(255, 235, 184, ${0.08 + seededNoise(grain, 13) * 0.08})`
		context.lineWidth = 2 + seededNoise(grain, 14) * 2
		context.beginPath()
		context.moveTo(0, y)
		for (let x = 0; x <= canvas.width; x += 96) {
			context.lineTo(x, y + Math.sin(x * 0.02 + grain) * 8)
		}
		context.stroke()
	}

	const shine = context.createRadialGradient(512, 270, 40, 512, 420, 760)
	shine.addColorStop(0, 'rgba(255, 232, 164, 0.3)')
	shine.addColorStop(0.48, 'rgba(255, 232, 164, 0.02)')
	shine.addColorStop(1, 'rgba(51, 30, 34, 0.36)')
	context.fillStyle = shine
	context.fillRect(0, 0, canvas.width, canvas.height)

	const texture = new CanvasTexture(canvas)
	texture.colorSpace = SRGBColorSpace
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.repeat.set(1.15, 1.15)
	texture.minFilter = LinearFilter
	texture.magFilter = LinearFilter
	texture.needsUpdate = true
	return texture
}

function drawBackdropPanel(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
) {
	context.fillStyle = color
	context.fillRect(x, y, width, height)
	context.fillStyle = 'rgba(255, 228, 169, 0.2)'
	for (let stripe = 0; stripe < 4; stripe += 1) {
		context.fillRect(x + 34 + stripe * 76, y + 18, 24, height - 36)
	}
	context.fillStyle = 'rgba(55, 29, 42, 0.18)'
	context.fillRect(x + 18, y + 26, width - 36, height - 52)
}

function drawSpotGlow(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
	const gradient = context.createRadialGradient(x, y, 20, x, y + 390, 430)
	gradient.addColorStop(0, color)
	gradient.addColorStop(0.18, 'rgba(255, 244, 192, 0.22)')
	gradient.addColorStop(0.72, 'rgba(255, 244, 192, 0)')
	context.fillStyle = gradient
	context.beginPath()
	context.moveTo(x - 96, 0)
	context.lineTo(x + 138, 0)
	context.lineTo(x + 304, 640)
	context.lineTo(x - 262, 640)
	context.closePath()
	context.fill()
	drawInkLine(context, [[x - 96, 0], [x - 262, 640]], 5, 'rgba(19, 20, 34, 0.2)')
	drawInkLine(context, [[x + 138, 0], [x + 304, 640]], 5, 'rgba(19, 20, 34, 0.16)')
}

function drawInkLine(
	context: CanvasRenderingContext2D,
	points: Array<[number, number]>,
	width: number,
	color: string,
) {
	context.strokeStyle = color
	context.lineWidth = width
	context.lineCap = 'round'
	context.lineJoin = 'round'
	context.beginPath()
	for (const [index, point] of points.entries()) {
		if (index === 0) {
			context.moveTo(point[0], point[1])
		}
		else {
			context.lineTo(point[0], point[1])
		}
	}
	context.stroke()
}

function seededNoise(index: number, salt: number) {
	const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
	return value - Math.floor(value)
}
