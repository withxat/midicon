import type { IconifyIcon } from '@iconify/types'
import type { ChangeEvent, CSSProperties } from 'react'
import type { Group } from 'three'

import type { AudioEngine } from './audio/types'
import type { InstrumentCategory } from './instrument-category'
import type { NoteEvent, Performer, Song, TrackSource } from './song'
import type { StagePlacement } from './stage/orchestra-layout'

import bellowsIcon from '@iconify-icons/game-icons/bellows'
import drumIcon from '@iconify-icons/game-icons/drum-kit'
import earthIcon from '@iconify-icons/game-icons/earth-asia-oceania'
import fluteIcon from '@iconify-icons/game-icons/flute'
import guitarIcon from '@iconify-icons/game-icons/guitar'
import bassIcon from '@iconify-icons/game-icons/guitar-bass-head'
import musicalKeyboardIcon from '@iconify-icons/game-icons/musical-keyboard'
import pianoIcon from '@iconify-icons/game-icons/piano-keys'
import saxophoneIcon from '@iconify-icons/game-icons/saxophone'
import singIcon from '@iconify-icons/game-icons/sing'
import trumpetIcon from '@iconify-icons/game-icons/trumpet'
import violinIcon from '@iconify-icons/game-icons/violin'
import xylophoneIcon from '@iconify-icons/game-icons/xylophone'
import { Icon } from '@iconify/react/offline'
import { Canvas, useFrame } from '@react-three/fiber'
import { Midi } from '@tonejs/midi'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture } from 'three'
import { Pause, Play, Repeat, RotateCcw, Upload } from 'ui/icons'

import { createPreferredEngine } from './audio/create-engine'
import { signalSoundFontName } from './audio/soundfont-sources'
import { categoryById } from './instrument-category'
import { groupTracksIntoPerformers, songFromMidi, withMidiBinary } from './midi-parse'
import {
	maxMidiFileSize,
	midiToNoteName,

} from './song'
import { DirectorCamera } from './stage/director-camera'
import { FloatingNotes } from './stage/floating-notes'
import { layoutOrchestra, stageRadius } from './stage/orchestra-layout'

const iconByCategory: Record<InstrumentCategory, IconifyIcon> = {
	bass: bassIcon,
	brass: trumpetIcon,
	choir: singIcon,
	ethnic: earthIcon,
	flute: fluteIcon,
	guitar: guitarIcon,
	mallet: xylophoneIcon,
	organ: bellowsIcon,
	percussion: drumIcon,
	piano: pianoIcon,
	reed: saxophoneIcon,
	strings: violinIcon,
	synth: musicalKeyboardIcon,
}

const demoSong: Song = buildDemoSong()

function buildDemoSong(): Song {
	const tracks: TrackSource[] = [
		makeDemoTrack('Piano', 0, 0, 0, [60, 64, 67, 72, 67, 64], 0.34),
		makeDemoTrack('Guitar', 25, 1, 0.18, [48, 55, 60, 55], 0.34),
		makeDemoTrack('Drums', 0, 9, 0, [36, 42, 38, 42], 0.12),
	]
	return {
		bpm: 112,
		duration: 13.5,
		fileName: 'midicon-demo.mid',
		performers: groupTracksIntoPerformers(tracks),
	}
}

function makeDemoTrack(
	name: string,
	program: number,
	channel: number,
	offset: number,
	notes: number[],
	duration: number,
): TrackSource {
	const events: NoteEvent[] = []

	for (let step = 0; step < 24; step += 1) {
		const midi = notes[step % notes.length]!
		events.push({
			duration,
			midi,
			name: midiToNoteName(midi),
			time: step * 0.5 + offset,
			velocity: 0.72,
		})
	}

	return { channel, name, notes: events, program }
}

export function App() {
	const [song, setSong] = useState<Song>(() => withMidiBinary(demoSong))
	const [focusedId, setFocusedId] = useState<null | string>(null)
	const [currentTime, setCurrentTime] = useState(0)
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLooping, setIsLooping] = useState(false)
	const [speed, setSpeed] = useState(1)
	const [uploadError, setUploadError] = useState('')
	const [engineLabel, setEngineLabel] = useState('Loading audio…')
	const [isAudioReady, setIsAudioReady] = useState(false)
	const playbackOffsetRef = useRef(0)
	const playbackSpeedRef = useRef(1)
	const playbackStartedAtRef = useRef(0)
	const isLoopingRef = useRef(false)
	const engineRef = useRef<AudioEngine | null>(null)
	const rafRef = useRef<null | number>(null)

	const focused = focusedId ? (song.performers.find(performer => performer.id === focusedId) ?? null) : null
	const scoreNotes = focused
		? focused.notes
		: song.performers.flatMap(performer => performer.notes).sort((a, b) => a.time - b.time)
	const scoreAccent = focused?.accent ?? '#ffcf70'

	const activeNotesByPerformer = useMemo(() => {
		const active = new Map<string, number>()

		for (const performer of song.performers) {
			const intensity = isPlaying && performer.notes.some(
				note => currentTime >= note.time && currentTime <= note.time + Math.max(note.duration, 0.14),
			)
				? 1
				: 0

			active.set(performer.id, intensity)
		}

		return active
	}, [currentTime, isPlaying, song.performers])

	const stopAnimationLoop = useCallback(() => {
		if (rafRef.current !== null) {
			cancelAnimationFrame(rafRef.current)
			rafRef.current = null
		}
	}, [])

	const tickPlayback = useCallback(() => {
		const engine = engineRef.current
		const elapsed = (performance.now() - playbackStartedAtRef.current) / 1000
		let nextTime = playbackOffsetRef.current + elapsed * playbackSpeedRef.current

		if (nextTime >= song.duration) {
			if (isLoopingRef.current) {
				const overshoot = nextTime - song.duration
				nextTime = overshoot % Math.max(song.duration, 0.01)
				playbackOffsetRef.current = nextTime
				playbackStartedAtRef.current = performance.now()
				setCurrentTime(nextTime)
				if (engine && !engine.hasNativeLoop) {
					engine.seek(nextTime)
					void engine.play()
				}
				rafRef.current = requestAnimationFrame(tickPlayback)
				return
			}
			engine?.pause()
			setCurrentTime(song.duration)
			setIsPlaying(false)
			rafRef.current = null
			return
		}

		setCurrentTime(nextTime)
		rafRef.current = requestAnimationFrame(tickPlayback)
	}, [song.duration])

	const startAnimationLoop = useCallback((fromTime: number, atSpeed: number) => {
		playbackOffsetRef.current = fromTime
		playbackSpeedRef.current = atSpeed
		playbackStartedAtRef.current = performance.now()
		stopAnimationLoop()
		rafRef.current = requestAnimationFrame(tickPlayback)
	}, [stopAnimationLoop, tickPlayback])

	const handlePlayPause = useCallback(() => {
		const engine = engineRef.current
		if (!engine) {
			return
		}

		if (isPlaying) {
			engine.pause()
			stopAnimationLoop()
			setIsPlaying(false)
			return
		}

		const startAt = currentTime >= song.duration ? 0 : currentTime
		if (startAt !== currentTime) {
			setCurrentTime(startAt)
		}
		engine.seek(startAt)
		void engine.play()
		setIsPlaying(true)
		startAnimationLoop(startAt, speed)
	}, [currentTime, isPlaying, song.duration, speed, startAnimationLoop, stopAnimationLoop])

	const handleReset = useCallback(() => {
		const engine = engineRef.current
		engine?.pause()
		engine?.seek(0)
		stopAnimationLoop()
		setCurrentTime(0)
		setIsPlaying(false)
	}, [stopAnimationLoop])

	const handleSeek = useCallback((value: number) => {
		const engine = engineRef.current
		setCurrentTime(value)
		engine?.seek(value)
		if (isPlaying) {
			startAnimationLoop(value, speed)
		}
	}, [isPlaying, speed, startAnimationLoop])

	const handleSpeedChange = useCallback((value: number) => {
		setSpeed(value)
		engineRef.current?.setSpeed(value)
		if (isPlaying) {
			startAnimationLoop(currentTime, value)
		}
	}, [currentTime, isPlaying, startAnimationLoop])

	const handleToggleLoop = useCallback(() => {
		setIsLooping((prev) => {
			const next = !prev
			isLoopingRef.current = next
			engineRef.current?.setLoop(next)
			return next
		})
	}, [])

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
			const midiBinary = await file.arrayBuffer()
			const midi = new Midi(midiBinary)
			const parsed = songFromMidi(midi, file.name, midiBinary)

			engineRef.current?.pause()
			stopAnimationLoop()
			setSong(parsed)
			setFocusedId(null)
			setCurrentTime(0)
			setIsPlaying(false)
			setUploadError('')
			event.target.value = ''
		}
		catch {
			setUploadError('That file could not be parsed as MIDI.')
			event.target.value = ''
		}
	}, [stopAnimationLoop])

	useEffect(() => {
		let cancelled = false
		let engine: AudioEngine | null = null

		void createPreferredEngine().then((loadedEngine) => {
			if (cancelled) {
				loadedEngine.dispose()
				return
			}
			engine = loadedEngine
			engineRef.current = loadedEngine
			loadedEngine.setLoop(isLoopingRef.current)
			loadedEngine.setSpeed(playbackSpeedRef.current || 1)
			setEngineLabel(loadedEngine.kind === 'spessasynth' ? signalSoundFontName : 'Web synth (Tone fallback)')
			setIsAudioReady(true)
		}).catch(() => {
			if (!cancelled) {
				setEngineLabel('Audio unavailable')
			}
		})

		return () => {
			cancelled = true
			stopAnimationLoop()
			engine?.pause()
			engine?.dispose()
			engineRef.current = null
		}
	}, [stopAnimationLoop])

	useEffect(() => {
		if (!isAudioReady || !engineRef.current) {
			return
		}
		const engine = engineRef.current
		void engine.loadSong(song).then(() => {
			engine.setLoop(isLoopingRef.current)
			engine.setSpeed(playbackSpeedRef.current || 1)
		})
	}, [isAudioReady, song])

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
					<button aria-label={isPlaying ? 'Pause' : 'Play'} className="grid size-[46px] place-items-center rounded-lg border border-transparent bg-[#75d7c4] text-[#18161f] transition duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50" disabled={!isAudioReady} onClick={handlePlayPause} type="button">
						{isPlaying ? <Pause size={18} /> : <Play size={18} />}
					</button>
					<button aria-label="Reset" className="grid size-[46px] place-items-center rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96]" onClick={handleReset} type="button">
						<RotateCcw size={18} />
					</button>
					<button
						aria-label="Loop"
						aria-pressed={isLooping}
						className={`grid size-[46px] place-items-center rounded-lg border transition duration-150 ease-out active:scale-[0.96] ${isLooping ? 'border-[#ffcf70] bg-[#ffcf70]/22 text-[#ffcf70]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
						onClick={handleToggleLoop}
						type="button"
					>
						<Repeat size={18} />
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

				<p className="font-mono text-[0.72rem] leading-snug text-[#fff8e7]/58">{engineLabel}</p>

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
					<Canvas camera={{ fov: 42, position: [0, 3.2, 11.4] }} dpr={[1, 1.8]}>
						<color args={['#191821']} attach="background" />
						<ambientLight intensity={1.8} />
						<directionalLight intensity={1.4} position={[4, 6, 4]} />
						<StageScene
							activeNotes={activeNotesByPerformer}
							focusedId={focusedId}
							isPlaying={isPlaying}
							onFocus={id => setFocusedId(previous => previous === id ? null : id)}
							performers={song.performers}
						/>
					</Canvas>
				</div>

				<div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
					{song.performers.map((performer) => {
						const def = categoryById[performer.category]
						const muted = focusedId !== null && performer.id !== focusedId
						return (
							<button
								aria-pressed={performer.id === focusedId}
								className={`grid min-h-[54px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border p-[9px_12px] text-left text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96] ${performer.id === focusedId ? 'border-(--accent) bg-[#ffcf70]/16' : 'border-[#fff8e7]/14 bg-[#fff8e7]/7'} ${muted ? 'opacity-55' : 'opacity-100'}`}
								key={performer.id}
								onClick={() => setFocusedId(previous => previous === performer.id ? null : performer.id)}
								style={{ '--accent': performer.accent } as CSSProperties}
								type="button"
							>
								<span className="grid size-[34px] place-items-center rounded-full bg-(--accent) text-[#211b22]">
									<Icon height={18} icon={iconByCategory[performer.category]} width={18} />
								</span>
								<span className="grid min-w-0 gap-0">
									<strong className="overflow-hidden text-ellipsis whitespace-nowrap">{def.label}</strong>
									<span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.66rem] text-[#fff8e7]/60">
										{performer.tracks.length}
										{performer.tracks.length === 1 ? ' track' : ' tracks'}
									</span>
								</span>
							</button>
						)
					})}
				</div>

				<section aria-label={focused ? `${focused.name} score` : 'Full arrangement score'} className="grid gap-4 rounded-lg border border-[#fff8e7]/14 bg-[#fff8e7]/7 p-[18px] shadow-[0_12px_46px_rgba(0,0,0,0.22)]">
					<div className="flex items-end justify-between gap-4 max-md:flex-col max-md:items-stretch">
						<div>
							<p className="mb-[7px] font-mono text-[0.72rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">{focused ? 'Focused part' : 'Global view'}</p>
							<h2 className="m-0 text-[clamp(1.5rem,3vw,2.6rem)] leading-[0.95] tracking-normal">{focused ? categoryById[focused.category].label : 'All parts'}</h2>
							<p className="mt-1 font-mono text-[0.72rem] leading-snug text-[#fff8e7]/60">
								{focused ? focused.tracks.map(track => track.name).join(' · ') : `${song.performers.length} performers in the full arrangement`}
							</p>
						</div>
					</div>
					<ScoreRoll accent={scoreAccent} currentTime={currentTime} notes={scoreNotes} />
				</section>
			</section>
		</main>
	)
}

function StageScene({
	activeNotes,
	focusedId,
	isPlaying,
	onFocus,
	performers,
}: {
	activeNotes: Map<string, number>
	focusedId: null | string
	isPlaying: boolean
	onFocus: (id: string) => void
	performers: Performer[]
}) {
	const placements = useMemo(() => layoutOrchestra(performers), [performers])
	const floorRadius = useMemo(() => stageRadius(placements), [placements])

	return (
		<>
			<DirectorCamera
				activeNotes={activeNotes}
				focusedId={focusedId}
				isPlaying={isPlaying}
				placements={placements}
				stageReach={floorRadius}
			/>
			<Stage
				activeNotes={activeNotes}
				floorRadius={floorRadius}
				focusedId={focusedId}
				isPlaying={isPlaying}
				onFocus={onFocus}
				performers={performers}
				placements={placements}
			/>
		</>
	)
}

function Stage({
	activeNotes,
	floorRadius,
	focusedId,
	isPlaying,
	onFocus,
	performers,
	placements,
}: {
	activeNotes: Map<string, number>
	floorRadius: number
	focusedId: null | string
	isPlaying: boolean
	onFocus: (id: string) => void
	performers: Performer[]
	placements: Map<string, StagePlacement>
}) {
	return (
		<group>
			<mesh position={[0, -1.35, 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
				<circleGeometry args={[floorRadius, 72]} />
				<meshStandardMaterial color="#292534" roughness={0.85} />
			</mesh>
			<mesh position={[0, -1.34, 2.4]} rotation={[-Math.PI / 2, 0, 0]}>
				<ringGeometry args={[0.2, 0.42, 32]} />
				<meshStandardMaterial color="#fff0ad" emissive="#ffcf70" emissiveIntensity={0.35} roughness={0.6} />
			</mesh>
			{performers.map((performer) => {
				const placement = placements.get(performer.id)
				if (!placement) {
					return null
				}

				const [x, y, z] = placement.position
				const liftAboveFloor = y + 0.62
				const riserHeight = Math.max(liftAboveFloor - 0.08, 0)
				const muted = focusedId !== null && performer.id !== focusedId

				return (
					<group key={performer.id}>
						{riserHeight > 0.02
							? (
									<mesh position={[x, -1.35 + riserHeight / 2, z - 0.32]}>
										<boxGeometry args={[1.05, riserHeight, 0.7]} />
										<meshStandardMaterial color="#332c44" opacity={muted ? 0.28 : 1} roughness={0.95} transparent={muted} />
									</mesh>
								)
							: null}
						<PerformerModel
							active={activeNotes.get(performer.id) ?? 0}
							focused={performer.id === focusedId}
							isPlaying={isPlaying}
							muted={muted}
							onFocus={() => onFocus(performer.id)}
							performer={performer}
							position={placement.position}
							rotationY={placement.rotationY}
						/>
					</group>
				)
			})}
		</group>
	)
}

function PerformerModel({
	active,
	focused,
	isPlaying,
	muted,
	onFocus,
	performer,
	position,
	rotationY,
}: {
	active: number
	focused: boolean
	isPlaying: boolean
	muted: boolean
	onFocus: () => void
	performer: Performer
	position: [number, number, number]
	rotationY: number
}) {
	const groupRef = useRef<Group>(null)
	const { texture: avatarTexture } = useCharacterArtwork(performer)

	useFrame(({ clock }) => {
		if (!groupRef.current) {
			return
		}
		const isActive = isPlaying && active > 0
		const sway = isActive ? Math.sin(clock.elapsedTime * 1.8 + position[0]) * 0.1 : 0
		const bounce = isActive ? 1 + Math.sin(clock.elapsedTime * 16) * 0.06 + 0.08 : 1
		groupRef.current.rotation.z = sway
		groupRef.current.scale.set(bounce, isActive ? 1 / bounce : 1, 1)
	})

	return (
		<group onClick={onFocus} position={position} rotation={[0, rotationY, 0]}>
			{focused
				? (
						<mesh position={[0, -0.6, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
							<circleGeometry args={[0.74, 40]} />
							<meshStandardMaterial color="#fff0ad" opacity={0.42} roughness={0.8} transparent />
						</mesh>
					)
				: null}
			<group ref={groupRef}>
				<mesh>
					<planeGeometry args={[1.4, 1.4]} />
					<meshBasicMaterial alphaTest={0.05} map={avatarTexture} opacity={muted ? 0.36 : 1} transparent />
				</mesh>
			</group>
			<FloatingNotes accent={performer.accent} active={muted ? 0 : active} isPlaying={isPlaying} />
		</group>
	)
}

interface CharacterArtwork {
	texture: CanvasTexture
}

function useCharacterArtwork(performer: Performer): CharacterArtwork {
	const artwork = useMemo(() => {
		const size = 384
		const canvas = document.createElement('canvas')
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext('2d')!
		drawFallbackCharacter(ctx, size, performer)

		const texture = new CanvasTexture(canvas)
		texture.needsUpdate = true
		return { canvas, texture }
	}, [performer])

	useEffect(() => {
		const def = categoryById[performer.category]
		const ctx = artwork.canvas.getContext('2d')!
		let cancelled = false

		drawFallbackCharacter(ctx, artwork.canvas.width, performer)
		artwork.texture.needsUpdate = true

		const image = new Image()
		image.decoding = 'async'
		image.onload = () => {
			if (cancelled) {
				return
			}
			ctx.clearRect(0, 0, artwork.canvas.width, artwork.canvas.height)
			drawContainImage(ctx, image, artwork.canvas.width)
			artwork.texture.needsUpdate = true
		}
		image.onerror = () => {
			if (!cancelled) {
				drawFallbackCharacter(ctx, artwork.canvas.width, performer)
				artwork.texture.needsUpdate = true
			}
		}
		image.src = def.imagePath

		return () => {
			cancelled = true
		}
	}, [artwork, performer])

	return { texture: artwork.texture }
}

function drawContainImage(context: CanvasRenderingContext2D, image: HTMLImageElement, size: number) {
	const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight)
	const width = image.naturalWidth * scale
	const height = image.naturalHeight * scale
	context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
}

function drawFallbackCharacter(context: CanvasRenderingContext2D, size: number, performer: Performer) {
	context.clearRect(0, 0, size, size)
	const padding = 32
	const inner = size - padding * 2
	const radius = 78

	const gradient = context.createLinearGradient(0, padding, 0, padding + inner)
	gradient.addColorStop(0, '#fff8e7')
	gradient.addColorStop(0.55, performer.accent)
	gradient.addColorStop(1, shadeColor(performer.accent, -0.4))

	roundRect(context, padding, padding, inner, inner, radius)
	context.fillStyle = gradient
	context.fill()

	const cx = size / 2
	const eyeY = size * 0.5
	const eyeOffset = 46
	const eyeR = 18

	context.fillStyle = '#2b2633'
	context.beginPath()
	context.arc(cx - eyeOffset, eyeY, eyeR, 0, Math.PI * 2)
	context.fill()
	context.beginPath()
	context.arc(cx + eyeOffset, eyeY, eyeR, 0, Math.PI * 2)
	context.fill()

	context.fillStyle = '#fff8e7'
	context.beginPath()
	context.arc(cx - eyeOffset + 6, eyeY - 6, 5, 0, Math.PI * 2)
	context.fill()
	context.beginPath()
	context.arc(cx + eyeOffset + 6, eyeY - 6, 5, 0, Math.PI * 2)
	context.fill()

	context.lineWidth = 9
	context.lineCap = 'round'
	context.strokeStyle = '#2b2633'
	context.beginPath()
	context.arc(cx, size * 0.65, 26, 0.18 * Math.PI, 0.82 * Math.PI)
	context.stroke()

	context.fillStyle = 'rgba(255, 170, 170, 0.55)'
	context.beginPath()
	context.arc(cx - 70, size * 0.65, 14, 0, Math.PI * 2)
	context.fill()
	context.beginPath()
	context.arc(cx + 70, size * 0.65, 14, 0, Math.PI * 2)
	context.fill()

	context.fillStyle = 'rgba(43, 38, 51, 0.78)'
	context.font = '700 30px Georgia, serif'
	context.textAlign = 'center'
	context.textBaseline = 'middle'
	context.fillText(categoryById[performer.category].label, cx, padding + 38)
}

function shadeColor(hex: string, amount: number): string {
	const trimmed = hex.replace('#', '')
	if (trimmed.length !== 6) {
		return hex
	}
	const r = Number.parseInt(trimmed.slice(0, 2), 16)
	const g = Number.parseInt(trimmed.slice(2, 4), 16)
	const b = Number.parseInt(trimmed.slice(4, 6), 16)
	const target = amount < 0 ? 0 : 255
	const blend = (channel: number) => Math.round(channel + (target - channel) * Math.abs(amount))
	return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`
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

function formatTime(seconds: number) {
	const minutes = Math.floor(seconds / 60)
	const remaining = Math.floor(seconds % 60).toString().padStart(2, '0')
	return `${minutes}:${remaining}`
}
