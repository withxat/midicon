import type { ChangeEvent, CSSProperties } from 'react'
import type { Mesh } from 'three'

import { Canvas, useFrame } from '@react-three/fiber'
import { Midi } from '@tonejs/midi'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
		<main className="app-shell">
			<section aria-label="MIDI player controls" className="control-rail">
				<div>
					<p className="eyebrow">Midicon MVP</p>
					<h1>Little MIDI stage</h1>
				</div>

				<label className="upload-button">
					<Upload aria-hidden="true" size={18} />
					<span>Upload MIDI</span>
					<input accept=".mid,.midi,audio/midi" onChange={handleUpload} type="file" />
				</label>
				{uploadError
					? <p className="upload-error" role="status">{uploadError}</p>
					: null}

				<div className="transport">
					<button aria-label={isPlaying ? 'Pause' : 'Play'} className="icon-button primary" onClick={handlePlayPause} type="button">
						{isPlaying ? <Pause size={18} /> : <Play size={18} />}
					</button>
					<button aria-label="Reset" className="icon-button" onClick={handleReset} type="button">
						<RotateCcw size={18} />
					</button>
				</div>

				<label className="slider-row">
					<span>{formatTime(currentTime)}</span>
					<input
						max={song.duration}
						min="0"
						onChange={event => handleSeek(Number(event.target.value))}
						step="0.01"
						type="range"
						value={currentTime}
					/>
					<span>{formatTime(song.duration)}</span>
				</label>

				<label className="speed-control">
					<span>Speed</span>
					<select onChange={event => handleSpeedChange(Number(event.target.value))} value={speed}>
						<option value={0.75}>0.75x</option>
						<option value={1}>1x</option>
						<option value={1.25}>1.25x</option>
						<option value={1.5}>1.5x</option>
					</select>
				</label>
			</section>

			<section className="stage-layout">
				<div className="song-strip">
					<div>
						<p className="eyebrow">Now playing</p>
						<h2>{song.fileName}</h2>
					</div>
					<div className="song-stats">
						<span>
							{song.performers.length}
							{' '}
							parts
						</span>
						<span>
							{Math.round(song.bpm)}
							{' '}
							bpm
						</span>
					</div>
				</div>

				<div className="stage-panel">
					<Canvas camera={{ fov: 43, position: [0, 3.1, 7.2] }} dpr={[1, 1.8]}>
						<color args={['#191821']} attach="background" />
						<ambientLight intensity={1.8} />
						<directionalLight intensity={1.4} position={[4, 6, 4]} />
						<Stage activeNotes={activeNotesByPerformer} focusedId={focused.id} onFocus={setFocusedId} performers={song.performers} />
					</Canvas>
				</div>

				<div className="ensemble-panel">
					{song.performers.map(performer => (
						<button
							className={`performer-chip ${performer.id === focused.id ? 'is-focused' : ''}`}
							key={performer.id}
							onClick={() => setFocusedId(performer.id)}
							style={{ '--accent': performer.accent } as CSSProperties}
							type="button"
						>
							<span>{performer.avatar}</span>
							<strong>{performer.name}</strong>
						</button>
					))}
				</div>

				<section aria-label={`${focused.name} score`} className="focus-panel">
					<div className="focus-heading">
						<div>
							<p className="eyebrow">Focused part</p>
							<h2>{focused.name}</h2>
						</div>
						<select onChange={event => updateInstrument(focused.id, event.target.value as InstrumentId)} value={focused.instrument}>
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
	onFocus,
	performers,
}: {
	activeNotes: Map<string, number>
	focusedId: string
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
	onFocus,
	performer,
	position,
}: {
	active: number
	focused: boolean
	onFocus: () => void
	performer: Performer
	position: [number, number, number]
}) {
	const bodyRef = useRef<Mesh>(null)
	const armRef = useRef<Mesh>(null)

	useFrame(({ clock }) => {
		const beat = Math.sin(clock.elapsedTime * 8) * active
		if (bodyRef.current) {
			bodyRef.current.position.y = 0.52 + beat * 0.08
			bodyRef.current.rotation.z = Math.sin(clock.elapsedTime * 2.4) * 0.04
		}
		if (armRef.current) {
			armRef.current.rotation.z = -0.35 - active * 0.45 + Math.sin(clock.elapsedTime * 10) * active * 0.1
		}
	})

	return (
		<group onClick={onFocus} position={position}>
			<mesh position={[0, -0.52, 0]}>
				<cylinderGeometry args={[0.48, 0.6, 0.24, 32]} />
				<meshStandardMaterial color={focused ? '#fff0ad' : '#40364b'} roughness={0.7} />
			</mesh>
			<mesh position={[0, 0.52, 0]} ref={bodyRef}>
				<sphereGeometry args={[0.58, 28, 28]} />
				<meshStandardMaterial color={performer.accent} roughness={0.58} />
			</mesh>
			<mesh position={[0, 1.18, 0]}>
				<sphereGeometry args={[0.34, 28, 28]} />
				<meshStandardMaterial color="#fff3d4" roughness={0.65} />
			</mesh>
			<mesh position={[0.5, 0.62, 0.06]} ref={armRef} rotation={[0, 0, -0.35]}>
				<capsuleGeometry args={[0.07, 0.62, 5, 12]} />
				<meshStandardMaterial color="#fff3d4" roughness={0.65} />
			</mesh>
			<mesh position={[-0.5, 0.62, 0.06]} rotation={[0, 0, 0.35]}>
				<capsuleGeometry args={[0.07, 0.62, 5, 12]} />
				<meshStandardMaterial color="#fff3d4" roughness={0.65} />
			</mesh>
			<InstrumentMesh instrument={performer.instrument} />
		</group>
	)
}

function InstrumentMesh({ instrument }: { instrument: InstrumentId }) {
	if (instrument === 'drums') {
		return (
			<group position={[0.18, 0.15, 0.36]}>
				<mesh rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.34, 0.34, 0.22, 32]} />
					<meshStandardMaterial color="#f9faf2" roughness={0.42} />
				</mesh>
				<mesh position={[0.38, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.18, 0.18, 0.12, 24]} />
					<meshStandardMaterial color="#ff8da1" roughness={0.5} />
				</mesh>
			</group>
		)
	}

	if (instrument === 'flute') {
		return (
			<mesh position={[0.18, 0.74, 0.38]} rotation={[0, 0, Math.PI / 2]}>
				<capsuleGeometry args={[0.045, 0.9, 8, 16]} />
				<meshStandardMaterial color="#d8f7ff" metalness={0.12} roughness={0.36} />
			</mesh>
		)
	}

	if (instrument === 'guitar' || instrument === 'bass') {
		return (
			<group position={[0.2, 0.22, 0.38]} rotation={[0, 0, -0.18]}>
				<mesh>
					<sphereGeometry args={[instrument === 'bass' ? 0.28 : 0.24, 24, 24]} />
					<meshStandardMaterial color={instrument === 'bass' ? '#a8b8ff' : '#ffcf70'} roughness={0.5} />
				</mesh>
				<mesh position={[0.45, 0.32, 0]} rotation={[0, 0, -0.68]}>
					<capsuleGeometry args={[0.045, instrument === 'bass' ? 0.95 : 0.72, 6, 12]} />
					<meshStandardMaterial color="#5b3d33" roughness={0.55} />
				</mesh>
			</group>
		)
	}

	return (
		<group position={[0.12, 0.2, 0.38]}>
			<mesh>
				<boxGeometry args={[0.72, 0.2, 0.24]} />
				<meshStandardMaterial color="#fff0ad" roughness={0.48} />
			</mesh>
			<mesh position={[0, 0.12, 0.01]}>
				<boxGeometry args={[0.62, 0.04, 0.26]} />
				<meshStandardMaterial color="#2b2633" roughness={0.4} />
			</mesh>
		</group>
	)
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

	return <canvas aria-label="Scrolling staff notation" className="score-roll" ref={canvasRef} />
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
