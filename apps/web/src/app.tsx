import type { IconifyIcon } from '@iconify/types'
import type { ChangeEvent, CSSProperties } from 'react'
import type { Group, Texture } from 'three'

import drumIcon from '@iconify-icons/game-icons/drum-kit'
import fluteIcon from '@iconify-icons/game-icons/flute'
import guitarIcon from '@iconify-icons/game-icons/guitar'
import bassIcon from '@iconify-icons/game-icons/guitar-bass-head'
import pianoIcon from '@iconify-icons/game-icons/piano-keys'
import { Icon } from '@iconify/react/offline'
import { Canvas, useFrame } from '@react-three/fiber'
import { Midi } from '@tonejs/midi'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture } from 'three'
import * as Tone from 'tone'
import { Pause, Play, RotateCcw, Upload } from 'ui/icons'

type InstrumentId = 'bass' | 'drums' | 'flute' | 'guitar' | 'piano'

interface NoteEvent {
	duration: number
	midi: number
	name: string
	time: number
	velocity: number
}

interface Performer {
	accent: string
	avatar: string
	id: string
	instrument: InstrumentId
	name: string
	notes: NoteEvent[]
}

interface Song {
	bpm: number
	duration: number
	fileName: string
	performers: Performer[]
}

const instruments: Array<{ id: InstrumentId, label: string }> = [
	{ id: 'piano', label: 'Toy Piano' },
	{ id: 'guitar', label: 'Tiny Guitar' },
	{ id: 'drums', label: 'Pocket Drums' },
	{ id: 'flute', label: 'Cloud Flute' },
	{ id: 'bass', label: 'Berry Bass' },
]

const palette = ['#ffcf70', '#ff8da1', '#75d7c4', '#a8b8ff', '#f59ee6']
const avatars = ['Mimi', 'Koko', 'Bibi', 'Nana', 'Lulu']
const maxMidiFileSize = 5 * 1024 * 1024
const iconByInstrument: Record<InstrumentId, IconifyIcon> = {
	bass: bassIcon,
	drums: drumIcon,
	flute: fluteIcon,
	guitar: guitarIcon,
	piano: pianoIcon,
}

const demoSong: Song = {
	bpm: 112,
	duration: 13.5,
	fileName: 'midicon-demo.mid',
	performers: [
		makeDemoPerformer('demo-1', 'Mimi Melody', 'piano', '#ffcf70', 0, [60, 64, 67, 72, 67, 64]),
		makeDemoPerformer('demo-2', 'Koko Pluck', 'guitar', '#75d7c4', 0.18, [48, 55, 60, 55]),
		makeDemoPerformer('demo-3', 'Bibi Beat', 'drums', '#ff8da1', 0, [36, 42, 38, 42]),
	],
}

function makeDemoPerformer(
	id: string,
	name: string,
	instrument: InstrumentId,
	accent: string,
	offset: number,
	notes: number[],
): Performer {
	const events: NoteEvent[] = []

	for (let step = 0; step < 24; step += 1) {
		const midi = notes[step % notes.length]!
		events.push({
			duration: instrument === 'drums' ? 0.12 : 0.34,
			midi,
			name: midiToNoteName(midi),
			time: step * 0.5 + offset,
			velocity: 0.72,
		})
	}

	return { accent, avatar: name.split(' ')[0] ?? name, id, instrument, name, notes: events }
}

export function App() {
	const [song, setSong] = useState<Song>(demoSong)
	const [focusedId, setFocusedId] = useState(demoSong.performers[0]!.id)
	const [currentTime, setCurrentTime] = useState(0)
	const [isPlaying, setIsPlaying] = useState(false)
	const [speed, setSpeed] = useState(1)
	const [uploadError, setUploadError] = useState('')
	const playbackOffsetRef = useRef(0)
	const playbackSpeedRef = useRef(1)
	const playbackStartedAtRef = useRef(0)
	const synthsRef = useRef<Tone.PolySynth<Tone.Synth>[]>([])
	const rafRef = useRef<null | number>(null)

	const focused = song.performers.find(performer => performer.id === focusedId) ?? song.performers[0]!

	const activeNotesByPerformer = useMemo(() => {
		const active = new Map<string, number>()

		for (const performer of song.performers) {
			const intensity = performer.notes.some(
				note => currentTime >= note.time && currentTime <= note.time + Math.max(note.duration, 0.14),
			)
				? 1
				: 0

			active.set(performer.id, intensity)
		}

		return active
	}, [currentTime, song.performers])

	const clearTransport = useCallback(() => {
		Tone.Transport.stop()
		Tone.Transport.cancel(0)
		for (const synth of synthsRef.current) {
			synth.dispose()
		}
		synthsRef.current = []
	}, [])

	const stopAnimationLoop = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current)
			rafRef.current = null
		}
	}, [])

	const tickPlayback = useCallback(() => {
		const elapsed = (performance.now() - playbackStartedAtRef.current) / 1000
		const nextTime = playbackOffsetRef.current + elapsed * playbackSpeedRef.current
		setCurrentTime(Math.min(nextTime, song.duration))

		if (nextTime >= song.duration) {
			clearTransport()
			stopAnimationLoop()
			setCurrentTime(song.duration)
			setIsPlaying(false)
			return
		}

		rafRef.current = requestAnimationFrame(tickPlayback)
	}, [clearTransport, song.duration, stopAnimationLoop])

	const playFrom = useCallback(async (time: number, playbackSpeed = speed) => {
		await Tone.start()
		clearTransport()
		playbackOffsetRef.current = time
		playbackSpeedRef.current = playbackSpeed
		playbackStartedAtRef.current = performance.now()

		const synths = song.performers.map(performer => createSynth(performer.instrument).toDestination())
		synthsRef.current = synths

		for (const [performerIndex, performer] of song.performers.entries()) {
			const synth = synths[performerIndex]!

			for (const note of performer.notes) {
				if (note.time + note.duration < time) {
					continue
				}

				Tone.Transport.schedule((scheduledTime) => {
					const pitch = performer.instrument === 'drums' ? drumPitch(note.midi) : note.name
					synth.triggerAttackRelease(pitch, Math.max(note.duration / playbackSpeed, 0.08), scheduledTime, note.velocity)
				}, Math.max((note.time - time) / playbackSpeed, 0))
			}
		}

		Tone.Transport.start('+0', 0)
		setIsPlaying(true)
		stopAnimationLoop()
		rafRef.current = requestAnimationFrame(tickPlayback)
	}, [clearTransport, song, speed, stopAnimationLoop, tickPlayback])

	const handlePlayPause = useCallback(() => {
		if (isPlaying) {
			clearTransport()
			stopAnimationLoop()
			setIsPlaying(false)
			return
		}

		void playFrom(currentTime >= song.duration ? 0 : currentTime)
	}, [clearTransport, currentTime, isPlaying, playFrom, song.duration, stopAnimationLoop])

	const handleReset = useCallback(() => {
		clearTransport()
		stopAnimationLoop()
		setCurrentTime(0)
		setIsPlaying(false)
	}, [clearTransport, stopAnimationLoop])

	const handleSeek = useCallback((value: number) => {
		setCurrentTime(value)
		if (isPlaying) {
			void playFrom(value)
		}
	}, [isPlaying, playFrom])

	const handleSpeedChange = useCallback((value: number) => {
		setSpeed(value)
		if (isPlaying) {
			void playFrom(currentTime, value)
		}
	}, [currentTime, isPlaying, playFrom])

	const handleUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) {
			return
		}
		if (file.size > maxMidiFileSize) {
			setUploadError('Please choose a MIDI file under 5 MB.')
			event.target.value = ''
			return
		}

		try {
			const midi = new Midi(await file.arrayBuffer())
			const parsed = songFromMidi(midi, file.name)

			clearTransport()
			stopAnimationLoop()
			setSong(parsed)
			setFocusedId(parsed.performers[0]!.id)
			setCurrentTime(0)
			setIsPlaying(false)
			setUploadError('')
			event.target.value = ''
		}
		catch {
			setUploadError('That file could not be parsed as MIDI.')
			event.target.value = ''
		}
	}, [clearTransport, stopAnimationLoop])

	const updateInstrument = useCallback((id: string, instrument: InstrumentId) => {
		setSong(previous => ({
			...previous,
			performers: previous.performers.map(performer => (
				performer.id === id ? { ...performer, instrument } : performer
			)),
		}))
	}, [])

	useEffect(() => () => {
		clearTransport()
		stopAnimationLoop()
	}, [clearTransport, stopAnimationLoop])

	return (
		<main className="grid min-h-screen grid-cols-1 text-[#fff8e7] md:grid-cols-[minmax(230px,280px)_minmax(0,1fr)]">
			<section
				aria-label="MIDI player controls"
				className="sticky top-0 flex min-h-screen flex-col gap-[22px] self-start border-r border-[#fff8e7]/12 bg-[#18161f]/82 px-[22px] py-7 shadow-[0_20px_80px_rgba(0,0,0,0.32)] backdrop-blur-[18px] max-md:static max-md:min-h-[auto]"
			>
				<div>
					<p className="mb-[7px] font-mono text-[0.72rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">Midicon MVP</p>
					<h1 className="m-0 max-w-[9ch] text-[clamp(2.4rem,6vw,4.8rem)] leading-[0.95] tracking-normal max-md:max-w-none max-md:text-5xl">Little MIDI stage</h1>
				</div>

				<label className="relative inline-flex min-h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-lg bg-[#ffcf70] px-4 font-extrabold text-[#201a22] shadow-[0_10px_28px_rgba(255,207,112,0.24)] transition duration-150 ease-out active:scale-[0.96]">
					<Upload aria-hidden="true" size={18} />
					<span>Upload MIDI</span>
					<input accept=".mid,.midi,audio/midi" className="absolute inset-0 cursor-pointer opacity-0" onChange={handleUpload} type="file" />
				</label>
				{uploadError
					? <p className="-mt-3 font-mono text-[0.74rem] leading-snug font-bold text-[#ffb3b3]" role="status">{uploadError}</p>
					: null}

				<div className="flex gap-2.5">
					<button aria-label={isPlaying ? 'Pause' : 'Play'} className="grid size-[46px] place-items-center rounded-lg border border-transparent bg-[#75d7c4] text-[#18161f] transition duration-150 ease-out active:scale-[0.96]" onClick={handlePlayPause} type="button">
						{isPlaying ? <Pause size={18} /> : <Play size={18} />}
					</button>
					<button aria-label="Reset" className="grid size-[46px] place-items-center rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96]" onClick={handleReset} type="button">
						<RotateCcw size={18} />
					</button>
				</div>

				<label className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 font-mono text-[0.78rem] text-[#fff8e7]/78">
					<span>{formatTime(currentTime)}</span>
					<input
						className="w-full accent-[#ffcf70]"
						max={song.duration}
						min="0"
						onChange={event => handleSeek(Number(event.target.value))}
						step="0.01"
						type="range"
						value={currentTime}
					/>
					<span>{formatTime(song.duration)}</span>
				</label>

				<label className="grid gap-2 font-mono text-[0.78rem] font-bold text-[#fff8e7]/76 uppercase">
					<span>Speed</span>
					<select className="min-h-[42px] rounded-lg border border-[#fff8e7]/18 bg-[#272431] px-3 pr-[34px] text-[#fff8e7]" onChange={event => handleSpeedChange(Number(event.target.value))} value={speed}>
						<option value={0.75}>0.75x</option>
						<option value={1}>1x</option>
						<option value={1.25}>1.25x</option>
						<option value={1.5}>1.5x</option>
					</select>
				</label>
			</section>

			<section className="grid min-w-0 grid-rows-[auto_minmax(360px,1fr)_auto_auto] gap-[18px] p-[26px] max-md:grid-rows-[auto_340px_auto_auto] max-md:p-3.5">
				<div className="flex items-center justify-between gap-[18px] rounded-lg border border-[#fff8e7]/14 bg-[#fff8e7]/7 p-[18px_20px] shadow-[0_12px_46px_rgba(0,0,0,0.22)] max-md:flex-col max-md:items-stretch">
					<div>
						<p className="mb-[7px] font-mono text-[0.72rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">Now playing</p>
						<h2 className="m-0 text-[clamp(1.5rem,3vw,2.6rem)] leading-[0.95] tracking-normal">{song.fileName}</h2>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<span className="rounded-lg bg-[#fff8e7] px-2.5 py-[7px] font-mono text-[0.74rem] font-extrabold text-[#18161f]">
							{song.performers.length}
							{' '}
							parts
						</span>
						<span className="rounded-lg bg-[#fff8e7] px-2.5 py-[7px] font-mono text-[0.74rem] font-extrabold text-[#18161f]">
							{Math.round(song.bpm)}
							{' '}
							bpm
						</span>
					</div>
				</div>

				<div className="overflow-hidden rounded-lg border border-[#ffcf70]/18 bg-[#191821] shadow-[inset_0_-40px_80px_rgba(255,207,112,0.08)] [&_canvas]:block">
					<Canvas camera={{ fov: 43, position: [0, 3.1, 7.2] }} dpr={[1, 1.8]}>
						<color args={['#191821']} attach="background" />
						<ambientLight intensity={1.8} />
						<directionalLight intensity={1.4} position={[4, 6, 4]} />
						<Stage activeNotes={activeNotesByPerformer} focusedId={focused.id} isPlaying={isPlaying} onFocus={setFocusedId} performers={song.performers} />
					</Canvas>
				</div>

				<div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
					{song.performers.map(performer => (
						<button
							className={`grid min-h-[54px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border p-[9px_12px] text-left text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96] ${performer.id === focused.id ? 'border-(--accent) bg-[#ffcf70]/16' : 'border-[#fff8e7]/14 bg-[#fff8e7]/7'}`}
							key={performer.id}
							onClick={() => setFocusedId(performer.id)}
							style={{ '--accent': performer.accent } as CSSProperties}
							type="button"
						>
							<span className="grid size-[34px] place-items-center rounded-full bg-(--accent) text-[0.72rem] font-black text-[#211b22]">{performer.avatar}</span>
							<strong className="overflow-hidden text-ellipsis whitespace-nowrap">{performer.name}</strong>
							<Icon className="text-[#ffcf70]" height={18} icon={iconByInstrument[performer.instrument]} width={18} />
						</button>
					))}
				</div>

				<section aria-label={`${focused.name} score`} className="grid gap-4 rounded-lg border border-[#fff8e7]/14 bg-[#fff8e7]/7 p-[18px] shadow-[0_12px_46px_rgba(0,0,0,0.22)]">
					<div className="flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch">
						<div>
							<p className="mb-[7px] font-mono text-[0.72rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">Focused part</p>
							<h2 className="m-0 text-[clamp(1.5rem,3vw,2.6rem)] leading-[0.95] tracking-normal">{focused.name}</h2>
						</div>
						<select className="min-h-[42px] rounded-lg border border-[#fff8e7]/18 bg-[#272431] px-3 pr-[34px] text-[#fff8e7]" onChange={event => updateInstrument(focused.id, event.target.value as InstrumentId)} value={focused.instrument}>
							{instruments.map(instrument => (
								<option key={instrument.id} value={instrument.id}>{instrument.label}</option>
							))}
						</select>
					</div>
					<ScoreRoll accent={focused.accent} currentTime={currentTime} notes={focused.notes} />
				</section>
			</section>
		</main>
	)
}

function Stage({
	activeNotes,
	focusedId,
	isPlaying,
	onFocus,
	performers,
}: {
	activeNotes: Map<string, number>
	focusedId: string
	isPlaying: boolean
	onFocus: (id: string) => void
	performers: Performer[]
}) {
	return (
		<group>
			<mesh position={[0, -1.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[4.8, 64]} />
				<meshStandardMaterial color="#292534" roughness={0.8} />
			</mesh>
			{performers.map((performer, index) => {
				const spacing = 2.2
				const center = ((performers.length - 1) * spacing) / 2

				return (
					<PerformerModel
						active={activeNotes.get(performer.id) ?? 0}
						focused={performer.id === focusedId}
						isPlaying={isPlaying}
						key={performer.id}
						onFocus={() => onFocus(performer.id)}
						performer={performer}
						position={[index * spacing - center, -0.62, 0]}
					/>
				)
			})}
		</group>
	)
}

function PerformerModel({
	active,
	focused,
	isPlaying,
	onFocus,
	performer,
	position,
}: {
	active: number
	focused: boolean
	isPlaying: boolean
	onFocus: () => void
	performer: Performer
	position: [number, number, number]
}) {
	const groupRef = useRef<Group>(null)
	const avatarTexture = useAvatarTexture(performer)
	const iconTexture = useInstrumentIconTexture(performer.instrument)

	useFrame(({ clock }) => {
		if (!groupRef.current) {
			return
		}
		const sway = isPlaying ? Math.sin(clock.elapsedTime * 1.8 + position[0]) * 0.1 : 0
		const bounce = active ? 1 + Math.sin(clock.elapsedTime * 16) * 0.06 + 0.08 : 1
		groupRef.current.rotation.z = sway
		groupRef.current.scale.set(bounce, active ? 1 / bounce : 1, 1)
	})

	return (
		<group onClick={onFocus} position={position}>
			<mesh position={[0, -0.6, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[0.74, 40]} />
				<meshStandardMaterial color={focused ? '#fff0ad' : '#302b40'} opacity={focused ? 0.42 : 0.24} roughness={0.8} transparent />
			</mesh>
			<group ref={groupRef}>
				<mesh>
					<planeGeometry args={[1.24, 1.52]} />
					<meshBasicMaterial map={avatarTexture} transparent />
				</mesh>
				<mesh position={[0.45, 0.54, 0.04]}>
					<circleGeometry args={[0.25, 32]} />
					<meshBasicMaterial color="#fff8e7" />
				</mesh>
				<mesh position={[0.45, 0.54, 0.05]}>
					<planeGeometry args={[0.34, 0.34]} />
					<meshBasicMaterial color="#2b2633" map={iconTexture} transparent />
				</mesh>
			</group>
		</group>
	)
}

function useAvatarTexture(performer: Performer) {
	return useMemo(() => {
		const canvas = document.createElement('canvas')
		canvas.width = 384
		canvas.height = 448
		const context = canvas.getContext('2d')!
		const gradient = context.createLinearGradient(0, 0, 384, 448)
		gradient.addColorStop(0, '#fff8e7')
		gradient.addColorStop(0.46, performer.accent)
		gradient.addColorStop(1, '#2b2633')

		context.fillStyle = 'rgba(0, 0, 0, 0)'
		context.fillRect(0, 0, 384, 448)
		roundRect(context, 56, 34, 272, 360, 80)
		context.fillStyle = gradient
		context.fill()
		context.lineWidth = 10
		context.strokeStyle = '#fff8e7'
		context.stroke()

		context.fillStyle = '#fff3d4'
		context.beginPath()
		context.arc(192, 142, 70, 0, Math.PI * 2)
		context.fill()
		context.fillStyle = '#2b2633'
		context.font = '900 64px Georgia, serif'
		context.textAlign = 'center'
		context.fillText(performer.avatar.slice(0, 2), 192, 278)

		const texture = new CanvasTexture(canvas)
		texture.needsUpdate = true
		return texture
	}, [performer])
}

function useInstrumentIconTexture(instrument: InstrumentId) {
	const [texture, setTexture] = useState<Texture>(() => createBlankIconTexture())

	useEffect(() => {
		let cancelled = false
		const icon = iconByInstrument[instrument]
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.width ?? 512}" height="${icon.height ?? 512}" viewBox="0 0 ${icon.width ?? 512} ${icon.height ?? 512}">${icon.body}</svg>`
		const image = new Image()
		image.onload = () => {
			if (cancelled) {
				return
			}
			const canvas = document.createElement('canvas')
			canvas.width = 256
			canvas.height = 256
			const context = canvas.getContext('2d')!
			context.drawImage(image, 18, 18, 220, 220)
			const nextTexture = new CanvasTexture(canvas)
			nextTexture.needsUpdate = true
			setTexture(nextTexture)
		}
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replaceAll('currentColor', '#2b2633'))}`
		return () => {
			cancelled = true
		}
	}, [instrument])

	return texture
}

function createBlankIconTexture() {
	const canvas = document.createElement('canvas')
	canvas.width = 4
	canvas.height = 4
	const texture = new CanvasTexture(canvas)
	texture.needsUpdate = true
	return texture
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
	context.beginPath()
	context.moveTo(x + radius, y)
	context.arcTo(x + width, y, x + width, y + height, radius)
	context.arcTo(x + width, y + height, x, y + height, radius)
	context.arcTo(x, y + height, x, y, radius)
	context.arcTo(x, y, x + width, y, radius)
	context.closePath()
}

function ScoreRoll({ accent, currentTime, notes }: { accent: string, currentTime: number, notes: NoteEvent[] }) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		const context = canvas?.getContext('2d')
		if (!canvas || !context) {
			return
		}

		const rect = canvas.getBoundingClientRect()
		const scale = window.devicePixelRatio || 1
		canvas.width = rect.width * scale
		canvas.height = rect.height * scale
		context.scale(scale, scale)
		drawScore(context, rect.width, rect.height, notes, currentTime, accent)
	}, [accent, currentTime, notes])

	return <canvas aria-label="Scrolling staff notation" className="block h-[188px] w-full rounded-lg border-0 shadow-[inset_0_0_0_1px_rgba(43,38,51,0.1)] max-md:h-40" ref={canvasRef} />
}

function drawScore(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
	notes: NoteEvent[],
	currentTime: number,
	accent: string,
) {
	context.clearRect(0, 0, width, height)
	context.fillStyle = '#fff8e7'
	context.fillRect(0, 0, width, height)

	const staffTop = height * 0.32
	const lineGap = 15

	context.strokeStyle = '#5e554c'
	context.lineWidth = 1
	for (let line = 0; line < 5; line += 1) {
		const y = staffTop + line * lineGap
		context.beginPath()
		context.moveTo(24, y)
		context.lineTo(width - 24, y)
		context.stroke()
	}

	context.fillStyle = '#2b2633'
	context.font = '700 18px Georgia, serif'
	context.fillText('𝄞', 34, staffTop + lineGap * 3.2)

	const secondsVisible = 7
	const lead = 1.2
	const start = Math.max(0, currentTime - lead)
	const xForTime = (time: number) => 74 + ((time - start) / secondsVisible) * (width - 120)

	for (const note of notes) {
		if (note.time < start - 1 || note.time > start + secondsVisible + 1) {
			continue
		}

		const x = xForTime(note.time)
		const y = staffTop + lineGap * 4 - ((note.midi - 60) * lineGap) / 2
		const isActive = currentTime >= note.time && currentTime <= note.time + note.duration

		context.fillStyle = isActive ? accent : '#2b2633'
		context.beginPath()
		context.ellipse(x, y, isActive ? 10 : 8, 6, -0.35, 0, Math.PI * 2)
		context.fill()
		context.strokeStyle = context.fillStyle
		context.beginPath()
		context.moveTo(x + 7, y - 2)
		context.lineTo(x + 7, y - 42)
		context.stroke()
	}

	const playheadX = xForTime(currentTime)
	context.strokeStyle = '#e14f4f'
	context.lineWidth = 2
	context.beginPath()
	context.moveTo(playheadX, 18)
	context.lineTo(playheadX, height - 18)
	context.stroke()
}

function songFromMidi(midi: Midi, fileName: string): Song {
	const tracks = midi.tracks.filter(track => track.notes.length > 0).slice(0, 5)
	const performers = tracks.map((track, index): Performer => ({
		accent: palette[index % palette.length]!,
		avatar: avatars[index % avatars.length]!,
		id: `track-${index}-${track.channel}`,
		instrument: instrumentFromMidi(track.instrument.number),
		name: track.name || track.instrument.name || `Track ${index + 1}`,
		notes: track.notes.slice(0, 900).map(note => ({
			duration: Math.max(note.duration, 0.08),
			midi: note.midi,
			name: note.name,
			time: note.time,
			velocity: Math.max(note.velocity, 0.35),
		})),
	}))

	if (performers.length === 0) {
		return { ...demoSong, fileName }
	}

	return {
		bpm: midi.header.tempos[0]?.bpm ?? 120,
		duration: Math.max(midi.duration, 1),
		fileName,
		performers,
	}
}

function instrumentFromMidi(program: number): InstrumentId {
	if (program >= 32 && program <= 39) {
		return 'bass'
	}
	if (program >= 24 && program <= 31) {
		return 'guitar'
	}
	if (program >= 72 && program <= 79) {
		return 'flute'
	}
	return 'piano'
}

function createSynth(instrument: InstrumentId) {
	if (instrument === 'bass') {
		return new Tone.PolySynth(Tone.Synth, {
			envelope: { attack: 0.01, decay: 0.12, release: 0.18, sustain: 0.35 },
			oscillator: { type: 'sawtooth' },
		})
	}

	if (instrument === 'flute') {
		return new Tone.PolySynth(Tone.Synth, {
			envelope: { attack: 0.04, decay: 0.18, release: 0.32, sustain: 0.7 },
			oscillator: { type: 'sine' },
		})
	}

	if (instrument === 'guitar') {
		return new Tone.PolySynth(Tone.Synth, {
			envelope: { attack: 0.005, decay: 0.18, release: 0.16, sustain: 0.18 },
			oscillator: { type: 'triangle' },
		})
	}

	if (instrument === 'drums') {
		return new Tone.PolySynth(Tone.Synth, {
			envelope: { attack: 0.001, decay: 0.08, release: 0.04, sustain: 0.02 },
			oscillator: { type: 'square' },
		})
	}

	return new Tone.PolySynth(Tone.Synth, {
		envelope: { attack: 0.01, decay: 0.1, release: 0.24, sustain: 0.28 },
		oscillator: { type: 'fatsine' },
	})
}

function midiToNoteName(midi: number) {
	const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
	const octave = Math.floor(midi / 12) - 1
	return `${names[midi % 12]}${octave}`
}

function drumPitch(midi: number) {
	if (midi <= 38) {
		return 'C2'
	}
	if (midi <= 46) {
		return 'G2'
	}
	return 'D3'
}

function formatTime(seconds: number) {
	const minutes = Math.floor(seconds / 60)
	const remaining = Math.floor(seconds % 60).toString().padStart(2, '0')
	return `${minutes}:${remaining}`
}
