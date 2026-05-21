import type { NoteEvent } from './song'

import { useEffect, useRef } from 'react'

export interface PianoRollTrack {
	accent: string
	id: string
	muted: boolean
	notes: NoteEvent[]
}

interface PianoRollProps {
	currentTime: number
	duration: number
	tracks: PianoRollTrack[]
}

/**
 * Canvas-based piano roll. Time scrolls on the X axis, MIDI pitch maps to the
 * Y axis, and each performer's notes get drawn with their accent color. Muted
 * tracks fade into the background so the focused performer pops out.
 */
export function PianoRoll({ currentTime, duration, tracks }: PianoRollProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		const context = canvas?.getContext('2d')
		if (!canvas || !context) {
			return
		}
		const rect = canvas.getBoundingClientRect()
		const scale = window.devicePixelRatio || 1
		canvas.width = Math.max(1, Math.round(rect.width * scale))
		canvas.height = Math.max(1, Math.round(rect.height * scale))
		context.setTransform(scale, 0, 0, scale, 0, 0)
		drawPianoRoll(context, rect.width, rect.height, tracks, currentTime, duration)
	}, [currentTime, duration, tracks])

	return (
		<canvas
			aria-label="MIDI piano roll"
			className="block h-full w-full rounded-lg"
			ref={canvasRef}
		/>
	)
}

interface DrawContext {
	height: number
	maxPitch: number
	minPitch: number
	padding: { bottom: number, left: number, right: number, top: number }
	rowHeight: number
	secondsVisible: number
	start: number
	width: number
}

function drawPianoRoll(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	tracks: PianoRollTrack[],
	currentTime: number,
	duration: number,
) {
	context.clearRect(0, 0, width, height)
	context.fillStyle = '#16141d'
	context.fillRect(0, 0, width, height)

	const padding = { bottom: 18, left: 38, right: 14, top: 14 }
	const innerHeight = Math.max(1, height - padding.top - padding.bottom)

	const visibleTracks = tracks.filter(track => track.notes.length > 0)
	let minPitch = 127
	let maxPitch = 0
	for (const track of visibleTracks) {
		for (const note of track.notes) {
			if (note.midi < minPitch) {
				minPitch = note.midi
			}
			if (note.midi > maxPitch) {
				maxPitch = note.midi
			}
		}
	}
	if (visibleTracks.length === 0 || minPitch > maxPitch) {
		minPitch = 60
		maxPitch = 72
	}
	// Pad the range so the lowest/highest notes don't sit right on the edge.
	minPitch = Math.max(0, minPitch - 1)
	maxPitch = Math.min(127, maxPitch + 1)
	const pitchSpan = Math.max(1, maxPitch - minPitch + 1)
	const rowHeight = innerHeight / pitchSpan

	const secondsVisible = 7
	const lead = 1.2
	const start = Math.max(0, currentTime - lead)
	const draw: DrawContext = {
		height,
		maxPitch,
		minPitch,
		padding,
		rowHeight,
		secondsVisible,
		start,
		width,
	}

	drawGrid(context, draw)
	drawPitchAxis(context, draw)

	// Background pass: muted tracks under the spotlight track so the focused
	// part visually dominates even when notes overlap.
	const orderedTracks = [...visibleTracks].sort((a, b) => {
		if (a.muted === b.muted) {
			return 0
		}
		return a.muted ? -1 : 1
	})
	for (const track of orderedTracks) {
		drawTrackNotes(context, draw, track, currentTime)
	}

	drawTimelineRuler(context, draw, duration)
	drawPlayhead(context, draw, currentTime)
}

function drawGrid(context: CanvasRenderingContext2D, draw: DrawContext) {
	const { height, maxPitch, minPitch, padding, rowHeight, width } = draw
	const left = padding.left
	const right = width - padding.right

	context.fillStyle = '#1c1925'
	for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
		if (isSharp(pitch)) {
			const y = yForPitch(pitch, draw)
			context.fillRect(left, y, right - left, rowHeight)
		}
	}

	context.strokeStyle = 'rgba(255, 248, 231, 0.06)'
	context.lineWidth = 1
	for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
		if (pitch % 12 === 0) {
			const y = yForPitch(pitch, draw) + rowHeight
			context.beginPath()
			context.moveTo(left, y)
			context.lineTo(right, y)
			context.stroke()
		}
	}

	context.strokeStyle = 'rgba(255, 248, 231, 0.04)'
	const top = padding.top
	const bottom = height - padding.bottom
	for (let step = 0; step <= draw.secondsVisible; step += 1) {
		const x = left + (step / draw.secondsVisible) * (right - left)
		context.beginPath()
		context.moveTo(x, top)
		context.lineTo(x, bottom)
		context.stroke()
	}
}

function drawPitchAxis(context: CanvasRenderingContext2D, draw: DrawContext) {
	const { maxPitch, minPitch, padding, rowHeight } = draw
	context.fillStyle = 'rgba(255, 248, 231, 0.42)'
	context.font = '600 9px "JetBrains Mono", ui-monospace, monospace'
	context.textAlign = 'right'
	context.textBaseline = 'middle'
	for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
		if (pitch % 12 !== 0) {
			continue
		}
		const y = yForPitch(pitch, draw) + rowHeight / 2
		context.fillText(`C${Math.floor(pitch / 12) - 1}`, padding.left - 6, y)
	}
}

function drawTrackNotes(
	context: CanvasRenderingContext2D,
	draw: DrawContext,
	track: PianoRollTrack,
	currentTime: number,
) {
	const { padding, rowHeight, secondsVisible, start, width } = draw
	const right = width - padding.right
	const left = padding.left
	const windowEnd = start + secondsVisible

	for (const note of track.notes) {
		if (note.time + note.duration < start || note.time > windowEnd) {
			continue
		}
		const noteX = xForTime(note.time, draw)
		const noteEnd = xForTime(note.time + Math.max(note.duration, 0.05), draw)
		const clampedX = Math.max(noteX, left)
		const clampedW = Math.max(2, Math.min(noteEnd, right) - clampedX)
		const noteY = yForPitch(note.midi, draw)
		const noteHeight = Math.max(2, rowHeight - 1)

		const isActive = currentTime >= note.time && currentTime <= note.time + note.duration
		const baseAlpha = track.muted ? 0.18 : 0.78
		const activeAlpha = track.muted ? 0.45 : 1
		const alpha = isActive ? activeAlpha : baseAlpha

		context.fillStyle = withAlpha(track.accent, alpha)
		roundedRect(context, clampedX, noteY + 0.5, clampedW, noteHeight, Math.min(3, noteHeight / 2))
		context.fill()

		if (isActive && !track.muted) {
			context.strokeStyle = withAlpha('#fff8e7', 0.55)
			context.lineWidth = 1
			roundedRect(context, clampedX, noteY + 0.5, clampedW, noteHeight, Math.min(3, noteHeight / 2))
			context.stroke()
		}
	}
}

function drawTimelineRuler(context: CanvasRenderingContext2D, draw: DrawContext, duration: number) {
	const { height, padding, secondsVisible, start, width } = draw
	const baselineY = height - padding.bottom + 4
	const right = width - padding.right
	const left = padding.left

	context.strokeStyle = 'rgba(255, 248, 231, 0.18)'
	context.lineWidth = 1
	context.beginPath()
	context.moveTo(left, baselineY)
	context.lineTo(right, baselineY)
	context.stroke()

	context.fillStyle = 'rgba(255, 248, 231, 0.5)'
	context.font = '600 9px "JetBrains Mono", ui-monospace, monospace'
	context.textAlign = 'center'
	context.textBaseline = 'top'

	const firstTick = Math.ceil(start)
	const lastTick = Math.min(Math.floor(start + secondsVisible), Math.max(0, Math.ceil(duration)))
	for (let second = firstTick; second <= lastTick; second += 1) {
		const x = xForTime(second, draw)
		context.beginPath()
		context.moveTo(x, baselineY)
		context.lineTo(x, baselineY + 3)
		context.stroke()
		context.fillText(`${second}s`, x, baselineY + 5)
	}
}

function drawPlayhead(context: CanvasRenderingContext2D, draw: DrawContext, currentTime: number) {
	const { height, padding } = draw
	const x = xForTime(currentTime, draw)
	const top = padding.top
	const bottom = height - padding.bottom

	context.strokeStyle = '#ff8da1'
	context.lineWidth = 1.5
	context.beginPath()
	context.moveTo(x, top)
	context.lineTo(x, bottom)
	context.stroke()

	context.fillStyle = '#ff8da1'
	context.beginPath()
	context.moveTo(x - 4, top)
	context.lineTo(x + 4, top)
	context.lineTo(x, top + 5)
	context.closePath()
	context.fill()
}

function isSharp(midi: number): boolean {
	const offset = ((midi % 12) + 12) % 12
	return offset === 1 || offset === 3 || offset === 6 || offset === 8 || offset === 10
}

function xForTime(time: number, draw: DrawContext): number {
	const { padding, secondsVisible, start, width } = draw
	const right = width - padding.right
	const left = padding.left
	return left + ((time - start) / secondsVisible) * (right - left)
}

function yForPitch(midi: number, draw: DrawContext): number {
	return draw.padding.top + (draw.maxPitch - midi) * draw.rowHeight
}

function roundedRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
) {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2))
	context.beginPath()
	context.moveTo(x + r, y)
	context.arcTo(x + width, y, x + width, y + height, r)
	context.arcTo(x + width, y + height, x, y + height, r)
	context.arcTo(x, y + height, x, y, r)
	context.arcTo(x, y, x + width, y, r)
	context.closePath()
}

function withAlpha(color: string, alpha: number): string {
	const hex = color.replace('#', '')
	if (hex.length !== 6) {
		return color
	}
	const r = Number.parseInt(hex.slice(0, 2), 16)
	const g = Number.parseInt(hex.slice(2, 4), 16)
	const b = Number.parseInt(hex.slice(4, 6), 16)
	const a = Math.max(0, Math.min(1, alpha))
	return `rgba(${r}, ${g}, ${b}, ${a})`
}
