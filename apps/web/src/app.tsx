import type { IconifyIcon } from '@iconify/types'
import type { ChangeEvent, CSSProperties } from 'react'
import type { Group, OrthographicCamera as OrthographicCameraImpl } from 'three'

import type { AudioEngine } from './audio/types'
import type { InstrumentCategory } from './instrument-category'
import type { PerformerArtworkAnchors, PerformerArtworkOffset } from './performer-artwork'
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
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Midi } from '@tonejs/midi'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CanvasTexture, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { BarChart3, Check, Copy, Crosshair, Move, Music, Pause, Play, Repeat, RotateCcw, Scaling, Upload, Users, X } from 'ui/icons'

import { createPreferredEngine } from './audio/create-engine'
import { FloatingPanel } from './floating-panel'
import { categoryById } from './instrument-category'
import { groupTracksIntoPerformers, songFromMidi, withMidiBinary } from './midi-parse'
import {
	activePerformerArtworkPresetId,
	defaultPerformerArtworkOffset,
	getPerformerArtworkAnchors,
	getPerformerArtworkScale,
	getPerformerArtworkSource,
	getPerformerArtworkStageOffset,
	getPerformerArtworkStageScale,
	performerArtworkPresets,
	sanitizeAnchors,
} from './performer-artwork'
import { PianoRoll } from './piano-roll'
import { ScoreModal } from './score-modal'
import {
	maxMidiFileSize,
	midiToNoteName,
} from './song'
import { TheaterBackground } from './stage/background-plane'
import { FloatingNotes } from './stage/floating-notes'
import {
	characterBaseHeight,
	characterBaseWidth,
	computeWorldViewport,
	layoutOrchestra,
} from './stage/orchestra-layout'
import { scoreSourceFromMusicXml, songFromMusicXml } from './verovio-musicxml'
import { VerovioScore } from './verovio-score'
import { convertMidiToMusicXml } from './webmscore-convert'

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

const isDevelopmentMode = import.meta.env.DEV
const performerScalesStorageKey = 'midicon:performer-scales'
const performerOffsetsStorageKey = 'midicon:performer-offsets'
const performerAnchorsStorageKey = 'midicon:performer-anchors'
const minPerformerScale = 0.4
const maxPerformerScale = 2.5
const minStageOffset = -4
const maxStageOffset = 4
const finalFileExtensionPattern = /\.[^./\\]+$/

const groundPlane = new Plane(new Vector3(0, 0, 1), 0)
const pointerRaycaster = new Raycaster()
const pointerNdc = new Vector2()
const pointerWorld = new Vector3()

/**
 * Convert a DOM pointer position to a world coordinate on the performer's
 * depth plane. Returns null if the ray misses the plane, which only happens at
 * oblique camera angles.
 */
function pointerToWorld(
	camera: Parameters<typeof pointerRaycaster.setFromCamera>[1],
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
	planeZ = 0,
): null | { x: number, y: number } {
	const rect = canvas.getBoundingClientRect()
	pointerNdc.set(
		((clientX - rect.left) / rect.width) * 2 - 1,
		-((clientY - rect.top) / rect.height) * 2 + 1,
	)
	pointerRaycaster.setFromCamera(pointerNdc, camera)
	groundPlane.constant = -planeZ
	const hit = pointerRaycaster.ray.intersectPlane(groundPlane, pointerWorld)
	if (!hit) {
		return null
	}
	return { x: pointerWorld.x, y: pointerWorld.y }
}

type PerformerOffset = PerformerArtworkOffset

function loadStoredOffsets(): Record<string, PerformerOffset> {
	if (typeof window === 'undefined') {
		return {}
	}
	try {
		const raw = window.localStorage.getItem(performerOffsetsStorageKey)
		if (!raw) {
			return {}
		}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== 'object') {
			return {}
		}
		const sanitized: Record<string, PerformerOffset> = {}
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!value || typeof value !== 'object') {
				continue
			}
			const v = value as { x?: unknown, y?: unknown }
			if (typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y)) {
				sanitized[id] = { x: v.x, y: v.y }
			}
		}
		return sanitized
	}
	catch {
		return {}
	}
}

function loadStoredScales(): Record<string, number> {
	if (typeof window === 'undefined') {
		return {}
	}
	try {
		const raw = window.localStorage.getItem(performerScalesStorageKey)
		if (!raw) {
			return {}
		}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== 'object') {
			return {}
		}
		const sanitized: Record<string, number> = {}
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				continue
			}
			sanitized[id] = clampScale(value)
		}
		return sanitized
	}
	catch {
		return {}
	}
}

function loadStoredAnchors(): Record<string, PerformerArtworkAnchors> {
	if (typeof window === 'undefined') {
		return {}
	}
	try {
		const raw = window.localStorage.getItem(performerAnchorsStorageKey)
		if (!raw) {
			return {}
		}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== 'object') {
			return {}
		}
		const sanitized: Record<string, PerformerArtworkAnchors> = {}
		for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!value || typeof value !== 'object') {
				continue
			}
			sanitized[id] = sanitizeAnchors(value as Partial<PerformerArtworkAnchors>)
		}
		return sanitized
	}
	catch {
		return {}
	}
}

function clampScale(value: number): number {
	return Math.min(maxPerformerScale, Math.max(minPerformerScale, value))
}

function clampStageOffset(value: number): number {
	return Math.min(maxStageOffset, Math.max(minStageOffset, value))
}

function getPerformerScale(performer: Performer, scales: Record<string, number>): number {
	return clampScale(scales[performer.id] ?? getPerformerArtworkStageScale(performer.category))
}

function getPerformerOffset(performer: Performer, offsets: Record<string, PerformerOffset>): PerformerOffset {
	return offsets[performer.id] ?? getPerformerArtworkStageOffset(performer.category)
}

function getPerformerAnchors(performer: Performer, anchors: Record<string, PerformerArtworkAnchors>): PerformerArtworkAnchors {
	return anchors[performer.id] ?? getPerformerArtworkAnchors(performer.category)
}

function anchorToLocalPosition(anchors: PerformerArtworkAnchors): { x: number, y: number } {
	return {
		x: (anchors.centerX - 0.5) * characterBaseWidth,
		y: (0.5 - anchors.headY) * characterBaseHeight,
	}
}

function buildArtworkConfigSnapshot(
	performers: Performer[],
	scales: Record<string, number>,
	offsets: Record<string, PerformerOffset>,
	anchors: Record<string, PerformerArtworkAnchors>,
): string {
	const performerByCategory = new Map<InstrumentCategory, Performer>(
		performers.map(performer => [performer.category, performer]),
	)
	const config = {
		activePresetId: activePerformerArtworkPresetId,
		presets: performerArtworkPresets.map(preset => ({
			id: preset.id,
			label: preset.label,
			performers: Object.fromEntries(
				Object.entries(preset.performers).map(([category, entry]) => {
					const performer = performerByCategory.get(category as InstrumentCategory)
					const offset = performer
						? getPerformerOffset(performer, offsets)
						: {
								x: entry.stage?.offset?.x ?? defaultPerformerArtworkOffset.x,
								y: entry.stage?.offset?.y ?? defaultPerformerArtworkOffset.y,
							}
					const scale = performer ? getPerformerScale(performer, scales) : (entry.stage?.scale ?? 1)
					const imageAnchors = performer ? getPerformerAnchors(performer, anchors) : sanitizeAnchors(entry.image.anchors)

					return [category, {
						image: {
							...entry.image,
							anchors: imageAnchors,
						},
						stage: {
							offset: {
								x: roundConfigNumber(offset.x),
								y: roundConfigNumber(offset.y),
							},
							scale: roundConfigNumber(scale),
						},
					}]
				}),
			),
		})),
	}
	return JSON.stringify(config, null, '\t')
}

async function writeTextToClipboard(text: string): Promise<void> {
	try {
		await window.navigator.clipboard.writeText(text)
	}
	catch {
		const textarea = document.createElement('textarea')
		textarea.value = text
		textarea.setAttribute('readonly', 'true')
		textarea.style.position = 'fixed'
		textarea.style.inset = '0 auto auto 0'
		textarea.style.opacity = '0'
		document.body.append(textarea)
		textarea.select()
		document.execCommand('copy')
		textarea.remove()
	}
}

function roundConfigNumber(value: number): number {
	return Number(value.toFixed(3))
}

function displayFileName(fileName: string): string {
	return fileName.replace(finalFileExtensionPattern, '')
}

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
	const [isAudioReady, setIsAudioReady] = useState(false)
	const playbackOffsetRef = useRef(0)
	const playbackSpeedRef = useRef(1)
	const playbackStartedAtRef = useRef(0)
	const isLoopingRef = useRef(false)
	const engineRef = useRef<AudioEngine | null>(null)
	const rafRef = useRef<null | number>(null)

	const [scoreState, setScoreState] = useState<'closed' | 'error' | 'loading' | 'open'>('closed')
	const [performersPanelOpen, setPerformersPanelOpen] = useState(false)
	const [rollPanelOpen, setRollPanelOpen] = useState(false)
	const [sizesPanelOpen, setSizesPanelOpen] = useState(false)
	const [anchorsPanelOpen, setAnchorsPanelOpen] = useState(false)
	const [editMode, setEditMode] = useState(false)
	const [performerScales, setPerformerScales] = useState<Record<string, number>>(() => loadStoredScales())
	const [performerOffsets, setPerformerOffsets] = useState<Record<string, PerformerOffset>>(() => loadStoredOffsets())
	const [performerAnchors, setPerformerAnchors] = useState<Record<string, PerformerArtworkAnchors>>(() => loadStoredAnchors())
	const [artworkConfigCopied, setArtworkConfigCopied] = useState(false)

	useEffect(() => {
		try {
			window.localStorage.setItem(performerScalesStorageKey, JSON.stringify(performerScales))
		}
		catch {
			// localStorage may be unavailable (private mode); the scales just won't persist.
		}
	}, [performerScales])

	useEffect(() => {
		try {
			window.localStorage.setItem(performerOffsetsStorageKey, JSON.stringify(performerOffsets))
		}
		catch {
			// As above; offsets just don't persist when storage is unavailable.
		}
	}, [performerOffsets])

	useEffect(() => {
		try {
			window.localStorage.setItem(performerAnchorsStorageKey, JSON.stringify(performerAnchors))
		}
		catch {
			// As above; anchors just don't persist when storage is unavailable.
		}
	}, [performerAnchors])

	const handleScaleChange = useCallback((id: string, value: number) => {
		setPerformerScales(previous => ({ ...previous, [id]: clampScale(value) }))
	}, [])

	const handleResetScales = useCallback(() => {
		setPerformerScales({})
	}, [])

	const handleOffsetChange = useCallback((id: string, x: number, y: number) => {
		setPerformerOffsets(previous => ({ ...previous, [id]: { x: clampStageOffset(x), y: clampStageOffset(y) } }))
	}, [])

	const handleResetOffsets = useCallback(() => {
		setPerformerOffsets({})
	}, [])

	const handleAnchorChange = useCallback((id: string, nextAnchors: Partial<PerformerArtworkAnchors>) => {
		setPerformerAnchors(previous => ({
			...previous,
			[id]: sanitizeAnchors({
				...(previous[id] ?? {}),
				...nextAnchors,
			}),
		}))
	}, [])

	const handleCopyArtworkConfig = useCallback(async () => {
		const snapshot = buildArtworkConfigSnapshot(song.performers, performerScales, performerOffsets, performerAnchors)
		await writeTextToClipboard(snapshot)
		setArtworkConfigCopied(true)
		window.setTimeout(setArtworkConfigCopied, 1500, false)
	}, [performerAnchors, performerOffsets, performerScales, song.performers])

	const focused = focusedId ? (song.performers.find(performer => performer.id === focusedId) ?? null) : null
	const scoreAccent = focused?.accent ?? '#ffcf70'
	const focusedAnchors = focused ? getPerformerAnchors(focused, performerAnchors) : null
	const focusedOffset = focused ? getPerformerOffset(focused, performerOffsets) : null
	const focusedScale = focused ? getPerformerScale(focused, performerScales) : 1
	const pianoRollTracks = useMemo(
		() => song.performers.map(performer => ({
			accent: performer.accent,
			id: performer.id,
			muted: focusedId !== null && performer.id !== focusedId,
			notes: performer.notes,
		})),
		[song.performers, focusedId],
	)

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
			setUploadError('Please choose a MIDI or MusicXML file under 5 MB.')
			event.target.value = ''
			return
		}

		try {
			const extension = file.name.split('.').pop()?.toLowerCase()
			let parsed: Song
			if (extension === 'musicxml' || extension === 'xml') {
				parsed = await songFromMusicXml(await file.text(), file.name)
			}
			else if (extension === 'mxl') {
				parsed = await songFromMusicXml(await file.arrayBuffer(), file.name)
			}
			else {
				const midiBinary = await file.arrayBuffer()
				const midi = new Midi(midiBinary)
				parsed = songFromMidi(midi, file.name, midiBinary)
			}

			engineRef.current?.pause()
			stopAnimationLoop()
			setSong(parsed)
			setFocusedId(null)
			setCurrentTime(0)
			setIsPlaying(false)
			setUploadError('')
			setScoreState('closed')
			event.target.value = ''
		}
		catch {
			setUploadError('That file could not be parsed as MIDI or MusicXML.')
			event.target.value = ''
		}
	}, [stopAnimationLoop])

	const handleOpenScore = useCallback(async () => {
		if (song.scoreSource) {
			setScoreState('open')
			return
		}
		if (!song.midiBinary) {
			setScoreState('error')
			return
		}
		setScoreState('loading')
		try {
			const musicXml = await convertMidiToMusicXml(song.midiBinary)
			if (!musicXml) {
				setScoreState('error')
				return
			}
			const scoreSource = await scoreSourceFromMusicXml(musicXml)
			if (!scoreSource) {
				setScoreState('error')
				return
			}
			setSong(previous => ({ ...previous, scoreSource }))
			setScoreState('open')
		}
		catch {
			setScoreState('error')
		}
	}, [song])

	const handleCloseScore = useCallback(() => {
		setScoreState(state => (state === 'loading' ? state : 'closed'))
	}, [])

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
			setIsAudioReady(true)
		}).catch(() => {
			if (!cancelled) {
				setIsAudioReady(false)
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
		<main className="relative h-dvh w-screen overflow-hidden bg-[#030304] text-[#fff8e7]">
			<div className={`absolute top-0 left-1/2 h-dvh aspect-[3/2] -translate-x-1/2 bg-[#030304] [&_canvas]:block ${editMode ? '[&_canvas]:cursor-grab [&_canvas:active]:cursor-grabbing' : ''}`}>
				<Canvas
					camera={{ far: 100, near: 0.1, position: [0, 0, 50], zoom: 100 }}
					dpr={[1, 1.8]}
					gl={{ alpha: true }}
					orthographic
				>
					<StageScene
						activeNotes={activeNotesByPerformer}
						anchors={performerAnchors}
						editMode={editMode}
						focusedId={focusedId}
						isPlaying={isPlaying}
						offsets={performerOffsets}
						onFocus={id => setFocusedId(previous => previous === id ? null : id)}
						onOffsetChange={handleOffsetChange}
						onScaleChange={handleScaleChange}
						performers={song.performers}
						scales={performerScales}
					/>
				</Canvas>
			</div>

			<div className="pointer-events-none absolute top-4 left-4 z-20 max-w-[60vw] max-md:right-4 max-md:max-w-none">
				<div className="pointer-events-auto rounded-lg border border-[#fff8e7]/12 bg-[#18161f]/72 px-4 py-2.5 shadow-[0_18px_50px_rgba(0,0,0,0.42)] backdrop-blur-[14px]">
					<p className="font-mono text-[0.62rem] font-bold tracking-[0.1em] text-[#ffcf70] uppercase">Now playing</p>
					<h1 className="m-0 mt-0.5 truncate text-[clamp(1rem,2.2vw,1.4rem)] leading-tight">{displayFileName(song.fileName)}</h1>
					<p className="mt-0.5 font-mono text-[0.66rem] text-[#fff8e7]/60">
						{song.performers.length}
						{' '}
						parts ·
						{' '}
						{Math.round(song.bpm)}
						{' '}
						bpm
					</p>
				</div>
			</div>

			<div className="pointer-events-none absolute top-4 right-4 z-20 flex gap-2 max-md:top-[7.75rem] max-md:left-4 max-md:right-auto max-md:gap-1.5">
				<label className="pointer-events-auto relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-lg bg-[#ffcf70] px-4 font-extrabold text-[#201a22] shadow-[0_10px_28px_rgba(255,207,112,0.28)] transition duration-150 ease-out active:scale-[0.96] max-md:px-3 max-md:text-[0.85rem]">
					<Upload aria-hidden="true" size={16} />
					<span>Upload</span>
					<input
						accept=".mid,.midi,.musicxml,.xml,.mxl,audio/midi,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml"
						className="absolute inset-0 cursor-pointer opacity-0"
						onChange={handleUpload}
						type="file"
					/>
				</label>
				<button
					className="pointer-events-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#ffcf70]/40 bg-[#18161f]/80 px-4 font-extrabold text-[#ffcf70] shadow-[0_12px_28px_rgba(0,0,0,0.4)] backdrop-blur-[12px] transition duration-150 ease-out hover:bg-[#ffcf70]/14 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 max-md:px-3 max-md:text-[0.85rem]"
					disabled={scoreState === 'loading'}
					onClick={handleOpenScore}
					type="button"
				>
					<Music aria-hidden="true" size={16} />
					<span>{scoreState === 'loading' ? 'Engraving…' : 'Score'}</span>
				</button>
			</div>

			{uploadError
				? (
						<div className="pointer-events-none absolute top-20 right-4 z-20 max-w-[420px]">
							<p className="pointer-events-auto rounded-lg border border-[#ffb3b3]/35 bg-[#3a1f24]/85 px-3 py-2 font-mono text-[0.72rem] font-bold text-[#ffb3b3] shadow-[0_12px_28px_rgba(0,0,0,0.4)] backdrop-blur-[10px]" role="status">
								{uploadError}
							</p>
						</div>
					)
				: null}
			{scoreState === 'error'
				? (
						<div className="pointer-events-none absolute top-20 right-4 z-20 max-w-[420px]">
							<p className="pointer-events-auto rounded-lg border border-[#ffb3b3]/35 bg-[#3a1f24]/85 px-3 py-2 font-mono text-[0.72rem] font-bold text-[#ffb3b3] shadow-[0_12px_28px_rgba(0,0,0,0.4)] backdrop-blur-[10px]" role="status">
								No engraved score available for this file.
							</p>
						</div>
					)
				: null}

			<div className="pointer-events-none absolute bottom-4 left-1/2 z-20 w-full max-w-[820px] -translate-x-1/2 px-4 max-md:bottom-2 max-md:px-2">
				<div className="pointer-events-auto grid gap-2.5 rounded-lg border border-[#fff8e7]/12 bg-[#18161f]/82 px-4 py-3 shadow-[0_22px_60px_rgba(0,0,0,0.5)] backdrop-blur-[16px] max-md:px-3 max-md:py-2.5">
					<div className="flex items-center gap-2.5 max-md:flex-wrap">
						<button
							aria-label={isPlaying ? 'Pause' : 'Play'}
							className="grid size-[42px] place-items-center rounded-lg border border-transparent bg-[#75d7c4] text-[#18161f] transition duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!isAudioReady}
							onClick={handlePlayPause}
							type="button"
						>
							{isPlaying ? <Pause size={18} /> : <Play size={18} />}
						</button>
						<button
							aria-label="Reset"
							className="grid size-[42px] place-items-center rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96]"
							onClick={handleReset}
							type="button"
						>
							<RotateCcw size={16} />
						</button>
						<button
							aria-label="Loop"
							aria-pressed={isLooping}
							className={`grid size-[42px] place-items-center rounded-lg border transition duration-150 ease-out active:scale-[0.96] ${isLooping ? 'border-[#ffcf70] bg-[#ffcf70]/22 text-[#ffcf70]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
							onClick={handleToggleLoop}
							type="button"
						>
							<Repeat size={16} />
						</button>

						<div className="grid flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 font-mono text-[0.74rem] text-[#fff8e7]/78">
							<span>{formatTime(currentTime)}</span>
							<input
								aria-label="Seek"
								className="w-full accent-[#ffcf70]"
								max={song.duration}
								min="0"
								onChange={event => handleSeek(Number(event.target.value))}
								step="0.01"
								type="range"
								value={currentTime}
							/>
							<span>{formatTime(song.duration)}</span>
						</div>

						<select
							aria-label="Playback speed"
							className="h-[40px] shrink-0 rounded-lg border border-[#fff8e7]/16 bg-[#272431] px-2 pr-[26px] font-mono text-[0.78rem] text-[#fff8e7]"
							onChange={event => handleSpeedChange(Number(event.target.value))}
							value={speed}
						>
							<option value={0.75}>0.75x</option>
							<option value={1}>1x</option>
							<option value={1.25}>1.25x</option>
							<option value={1.5}>1.5x</option>
						</select>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-2 max-md:justify-start">
						<button
							aria-pressed={performersPanelOpen}
							className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-[0.72rem] font-bold tracking-[0.05em] uppercase transition duration-150 ease-out active:scale-[0.96] ${performersPanelOpen ? 'border-[#ffcf70]/40 bg-[#ffcf70]/14 text-[#ffcf70]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
							onClick={() => setPerformersPanelOpen(open => !open)}
							type="button"
						>
							<Users aria-hidden="true" size={14} />
							<span>
								Performers
								<span className="ml-1 opacity-60">{song.performers.length}</span>
							</span>
						</button>
						<button
							aria-pressed={sizesPanelOpen}
							className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-[0.72rem] font-bold tracking-[0.05em] uppercase transition duration-150 ease-out active:scale-[0.96] ${sizesPanelOpen ? 'border-[#ffcf70]/40 bg-[#ffcf70]/14 text-[#ffcf70]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
							onClick={() => setSizesPanelOpen(open => !open)}
							type="button"
						>
							<Scaling aria-hidden="true" size={14} />
							<span>Sizes</span>
						</button>
						<button
							aria-pressed={editMode}
							className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-[0.72rem] font-bold tracking-[0.05em] uppercase transition duration-150 ease-out active:scale-[0.96] ${editMode ? 'border-[#75d7c4]/55 bg-[#75d7c4]/18 text-[#75d7c4]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
							onClick={() => setEditMode(value => !value)}
							title="Drag to move characters, scroll to resize"
							type="button"
						>
							<Move aria-hidden="true" size={14} />
							<span>{editMode ? 'Editing' : 'Edit'}</span>
						</button>
						{isDevelopmentMode
							? (
									<button
										aria-pressed={anchorsPanelOpen}
										className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-[0.72rem] font-bold tracking-[0.05em] uppercase transition duration-150 ease-out active:scale-[0.96] ${anchorsPanelOpen ? 'border-[#75d7c4]/55 bg-[#75d7c4]/18 text-[#75d7c4]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
										onClick={() => setAnchorsPanelOpen(open => !open)}
										title="Edit artwork anchors"
										type="button"
									>
										<Crosshair aria-hidden="true" size={14} />
										<span>Anchors</span>
									</button>
								)
							: null}
						<button
							aria-pressed={rollPanelOpen}
							className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 font-mono text-[0.72rem] font-bold tracking-[0.05em] uppercase transition duration-150 ease-out active:scale-[0.96] ${rollPanelOpen ? 'border-[#ffcf70]/40 bg-[#ffcf70]/14 text-[#ffcf70]' : 'border-[#fff8e7]/16 bg-[#fff8e7]/8 text-[#fff8e7]'}`}
							onClick={() => setRollPanelOpen(open => !open)}
							type="button"
						>
							<BarChart3 aria-hidden="true" size={14} />
							<span>Piano roll</span>
						</button>
					</div>
				</div>
			</div>

			{performersPanelOpen
				? (
						<FloatingPanel
							align="bottom-left"
							onClose={() => setPerformersPanelOpen(false)}
							subtitle={focused ? `Focused on ${categoryById[focused.category].label}` : 'Click to spotlight a performer'}
							title={`Performers · ${song.performers.length}`}
						>
							<div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-auto pr-1">
								{song.performers.map((performer) => {
									const def = categoryById[performer.category]
									const muted = focusedId !== null && performer.id !== focusedId
									return (
										<button
											aria-pressed={performer.id === focusedId}
											className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border p-[8px_10px] text-left text-[#fff8e7] transition duration-150 ease-out active:scale-[0.96] ${performer.id === focusedId ? 'border-(--accent) bg-[#ffcf70]/14' : 'border-[#fff8e7]/14 bg-[#fff8e7]/6'} ${muted ? 'opacity-60' : 'opacity-100'}`}
											key={performer.id}
											onClick={() => setFocusedId(previous => previous === performer.id ? null : performer.id)}
											style={{ '--accent': performer.accent } as CSSProperties}
											type="button"
										>
											<span className="grid size-[30px] place-items-center rounded-full bg-(--accent) text-[#211b22]">
												<Icon height={16} icon={iconByCategory[performer.category]} width={16} />
											</span>
											<span className="grid min-w-0 gap-0">
												<strong className="truncate text-[0.85rem]">{def.label}</strong>
												<span className="truncate font-mono text-[0.62rem] text-[#fff8e7]/60">
													{performer.tracks.length}
													{performer.tracks.length === 1 ? ' track' : ' tracks'}
												</span>
											</span>
										</button>
									)
								})}
							</div>
						</FloatingPanel>
					)
				: null}

			{sizesPanelOpen
				? (
						<FloatingPanel
							align="top-left"
							onClose={() => setSizesPanelOpen(false)}
							subtitle={`${minPerformerScale.toFixed(1)}× – ${maxPerformerScale.toFixed(1)}×`}
							title="Character sizes"
						>
							<div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-auto pr-1">
								{song.performers.map((performer) => {
									const def = categoryById[performer.category]
									const scale = getPerformerScale(performer, performerScales)
									return (
										<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5" key={performer.id} style={{ '--accent': performer.accent } as CSSProperties}>
											<span className="grid size-[28px] place-items-center rounded-full bg-(--accent) text-[#211b22]">
												<Icon height={14} icon={iconByCategory[performer.category]} width={14} />
											</span>
											<label className="grid min-w-0 gap-1">
												<span className="truncate text-[0.78rem] font-bold">{def.label}</span>
												<input
													aria-label={`${def.label} size`}
													className="w-full accent-(--accent)"
													max={maxPerformerScale}
													min={minPerformerScale}
													onChange={event => handleScaleChange(performer.id, Number(event.target.value))}
													step="0.05"
													type="range"
													value={scale}
												/>
											</label>
											<span className="min-w-[3ch] text-right font-mono text-[0.7rem] text-[#fff8e7]/60">
												{scale.toFixed(2)}
												x
											</span>
										</div>
									)
								})}
								<div className="mt-1 grid grid-cols-2 gap-2">
									<button
										className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/8 px-3 font-mono text-[0.7rem] font-bold tracking-[0.05em] text-[#fff8e7] uppercase transition duration-150 ease-out hover:bg-[#fff8e7]/14 active:scale-[0.96]"
										onClick={handleResetScales}
										type="button"
									>
										<RotateCcw aria-hidden="true" size={14} />
										<span>Reset sizes</span>
									</button>
									<button
										className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/8 px-3 font-mono text-[0.7rem] font-bold tracking-[0.05em] text-[#fff8e7] uppercase transition duration-150 ease-out hover:bg-[#fff8e7]/14 active:scale-[0.96]"
										onClick={handleResetOffsets}
										type="button"
									>
										<RotateCcw aria-hidden="true" size={14} />
										<span>Reset positions</span>
									</button>
								</div>
							</div>
						</FloatingPanel>
					)
				: null}

			{isDevelopmentMode && anchorsPanelOpen
				? (
						<div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-[#030304]/56 p-4 backdrop-blur-[3px]">
							<div className="grid max-h-[min(760px,calc(100dvh-2rem))] w-[min(920px,calc(100vw-2rem))] grid-cols-[minmax(280px,0.95fr)_minmax(280px,1fr)] overflow-hidden rounded-lg border border-[#fff8e7]/14 bg-[#15131b]/94 shadow-[0_24px_80px_rgba(0,0,0,0.58)] max-md:grid-cols-1">
								<div className="grid min-h-0 gap-3 border-r border-[#fff8e7]/10 p-4 max-md:border-r-0 max-md:border-b">
									<div className="flex items-start justify-between gap-3">
										<div>
											<p className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-[#75d7c4] uppercase">Artwork anchors</p>
											<p className="mt-1 text-[0.8rem] text-[#fff8e7]/62">
												{focused ? `${categoryById[focused.category].label} calibration` : 'Select a performer first'}
											</p>
										</div>
										<button
											aria-label="Close anchor editor"
											className="grid size-9 place-items-center rounded-lg border border-[#fff8e7]/14 bg-[#fff8e7]/8 text-[#fff8e7] transition duration-150 ease-out hover:bg-[#fff8e7]/14 active:scale-[0.96]"
											onClick={() => setAnchorsPanelOpen(false)}
											type="button"
										>
											<X aria-hidden="true" size={14} />
										</button>
									</div>

									{focused && focusedAnchors
										? (
												<AnchorPreview
													accent={focused.accent}
													anchors={focusedAnchors}
													imageSrc={getPerformerArtworkSource(focused.category)?.src ?? ''}
												/>
											)
										: (
												<div className="grid min-h-[320px] place-items-center rounded-lg border border-[#fff8e7]/12 bg-[#08070a] p-5 text-center text-[0.82rem] text-[#fff8e7]/62">
													Choose a performer to show its artwork, head line, center line and foot line.
												</div>
											)}
								</div>

								<div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4 text-[#fff8e7]">
									{focused && focusedAnchors && focusedOffset
										? (
												<>
													<div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-[#fff8e7]/12 bg-[#fff8e7]/6 p-2.5" style={{ '--accent': focused.accent } as CSSProperties}>
														<span className="grid size-[30px] place-items-center rounded-full bg-(--accent) text-[#211b22]">
															<Icon height={16} icon={iconByCategory[focused.category]} width={16} />
														</span>
														<div className="min-w-0">
															<p className="truncate text-[0.85rem] font-extrabold">{categoryById[focused.category].label}</p>
															<p className="truncate font-mono text-[0.62rem] text-[#fff8e7]/55">{focused.id}</p>
														</div>
													</div>

													<div className="grid content-start gap-3 overflow-auto pr-1">
														<AnchorSlider
															accent={focused.accent}
															label="Center line"
															max={1}
															min={0}
															onChange={value => handleAnchorChange(focused.id, { centerX: value })}
															step={0.01}
															value={focusedAnchors.centerX}
														/>
														<AnchorSlider
															accent={focused.accent}
															label="Note origin"
															max={1}
															min={0}
															onChange={value => handleAnchorChange(focused.id, { headY: value })}
															step={0.01}
															value={focusedAnchors.headY}
														/>
														<AnchorSlider
															accent={focused.accent}
															label="Foot line"
															max={1}
															min={0}
															onChange={value => handleAnchorChange(focused.id, { footY: value })}
															step={0.01}
															value={focusedAnchors.footY}
														/>
														<AnchorSlider
															accent={focused.accent}
															label="Stage size"
															max={maxPerformerScale}
															min={minPerformerScale}
															onChange={value => handleScaleChange(focused.id, value)}
															step={0.05}
															value={focusedScale}
														/>
														<AnchorSlider
															accent={focused.accent}
															label="Offset X"
															max={maxStageOffset}
															min={minStageOffset}
															onChange={value => handleOffsetChange(focused.id, value, focusedOffset.y)}
															step={0.05}
															value={focusedOffset.x}
														/>
														<AnchorSlider
															accent={focused.accent}
															label="Offset Y"
															max={maxStageOffset}
															min={minStageOffset}
															onChange={value => handleOffsetChange(focused.id, focusedOffset.x, value)}
															step={0.05}
															value={focusedOffset.y}
														/>
													</div>
												</>
											)
										: (
												<p className="rounded-lg border border-[#fff8e7]/12 bg-[#fff8e7]/6 p-3 text-[0.82rem] text-[#fff8e7]/70">
													Open Performers and choose one character to calibrate.
												</p>
											)}

									<button
										className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#75d7c4]/40 bg-[#75d7c4]/14 px-3 font-mono text-[0.7rem] font-bold tracking-[0.05em] text-[#75d7c4] uppercase transition duration-150 ease-out hover:bg-[#75d7c4]/20 active:scale-[0.96]"
										onClick={() => void handleCopyArtworkConfig()}
										type="button"
									>
										{artworkConfigCopied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
										<span>{artworkConfigCopied ? 'Copied JSON' : 'Copy JSON'}</span>
									</button>
								</div>
							</div>
						</div>
					)
				: null}

			{rollPanelOpen
				? (
						<FloatingPanel
							align="bottom-right"
							onClose={() => setRollPanelOpen(false)}
							subtitle={focused ? `Focused on ${categoryById[focused.category].label}` : `${song.performers.length} performers`}
							title="Piano roll"
						>
							<div className="h-[260px] overflow-hidden rounded-lg bg-[#16141d] shadow-[inset_0_0_0_1px_rgba(255,248,231,0.04)] max-md:h-[200px]">
								<PianoRoll currentTime={currentTime} duration={song.duration} tracks={pianoRollTracks} />
							</div>
						</FloatingPanel>
					)
				: null}

			{scoreState === 'open' && song.scoreSource
				? (
						<ScoreModal
							onClose={handleCloseScore}
							subtitle={focused ? `Focused on ${categoryById[focused.category].label}` : `${song.performers.length} performers`}
							title={song.fileName}
						>
							<VerovioScore
								accent={scoreAccent}
								currentTime={currentTime}
								focusedCategory={focused?.category ?? null}
								scoreSource={song.scoreSource}
							/>
						</ScoreModal>
					)
				: null}
		</main>
	)
}

function AnchorSlider({
	accent,
	label,
	max,
	min,
	onChange,
	step,
	value,
}: {
	accent: string
	label: string
	max: number
	min: number
	onChange: (value: number) => void
	step: number
	value: number
}) {
	return (
		<label className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_4.5rem] items-center gap-2.5" style={{ '--accent': accent } as CSSProperties}>
			<span className="text-[0.76rem] font-bold text-[#fff8e7]/78">{label}</span>
			<input
				className="w-full accent-(--accent)"
				max={max}
				min={min}
				onChange={event => onChange(Number(event.target.value))}
				step={step}
				type="range"
				value={value}
			/>
			<span className="text-right font-mono text-[0.7rem] text-[#fff8e7]/58">{value.toFixed(2)}</span>
		</label>
	)
}

function AnchorPreview({
	accent,
	anchors,
	imageSrc,
}: {
	accent: string
	anchors: PerformerArtworkAnchors
	imageSrc: string
}) {
	return (
		<div className="grid min-h-0 gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-[#fff8e7]/12 bg-[#08070a] shadow-[inset_0_0_0_1px_rgba(255,248,231,0.04)]" style={{ '--accent': accent } as CSSProperties}>
				{imageSrc
					? <img alt="" className="absolute inset-0 size-full object-contain p-6" draggable={false} src={imageSrc} />
					: null}
				<div className="absolute inset-x-6 top-[var(--head-y)] h-px bg-[#ffcf70] shadow-[0_0_12px_rgba(255,207,112,0.7)]" style={{ '--head-y': `${anchors.headY * 100}%` } as CSSProperties} />
				<div className="absolute inset-x-6 top-[var(--foot-y)] h-px bg-[#ff8da1] shadow-[0_0_12px_rgba(255,141,161,0.7)]" style={{ '--foot-y': `${anchors.footY * 100}%` } as CSSProperties} />
				<div className="absolute inset-y-6 left-[var(--center-x)] w-px bg-[#75d7c4] shadow-[0_0_12px_rgba(117,215,196,0.7)]" style={{ '--center-x': `${anchors.centerX * 100}%` } as CSSProperties} />
				<div className="absolute left-[var(--center-x)] top-[var(--head-y)] grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#ffcf70]/70 bg-[#15131b]/82 font-mono text-[1rem] text-[#ffcf70] shadow-[0_0_18px_rgba(255,207,112,0.28)]" style={{ '--center-x': `${anchors.centerX * 100}%`, '--head-y': `${anchors.headY * 100}%` } as CSSProperties}>
					♪
				</div>
				<span className="absolute top-[calc(var(--head-y)+0.35rem)] left-8 rounded bg-[#08070a]/82 px-1.5 py-0.5 font-mono text-[0.62rem] font-bold tracking-[0.05em] text-[#ffcf70] uppercase" style={{ '--head-y': `${anchors.headY * 100}%` } as CSSProperties}>note origin</span>
				<span className="absolute top-[calc(var(--foot-y)+0.35rem)] left-8 rounded bg-[#08070a]/82 px-1.5 py-0.5 font-mono text-[0.62rem] font-bold tracking-[0.05em] text-[#ff8da1] uppercase" style={{ '--foot-y': `${anchors.footY * 100}%` } as CSSProperties}>foot line</span>
			</div>
			<div className="grid grid-cols-3 gap-2 font-mono text-[0.62rem] font-bold tracking-[0.05em] uppercase">
				<span className="rounded border border-[#75d7c4]/24 bg-[#75d7c4]/10 px-2 py-1 text-[#75d7c4]">
					Center
					{' '}
					{anchors.centerX.toFixed(2)}
				</span>
				<span className="rounded border border-[#ffcf70]/24 bg-[#ffcf70]/10 px-2 py-1 text-[#ffcf70]">
					Head
					{' '}
					{anchors.headY.toFixed(2)}
				</span>
				<span className="rounded border border-[#ff8da1]/24 bg-[#ff8da1]/10 px-2 py-1 text-[#ff8da1]">
					Foot
					{' '}
					{anchors.footY.toFixed(2)}
				</span>
			</div>
		</div>
	)
}

function StageScene({
	activeNotes,
	anchors,
	editMode,
	focusedId,
	isPlaying,
	offsets,
	onFocus,
	onOffsetChange,
	onScaleChange,
	performers,
	scales,
}: {
	activeNotes: Map<string, number>
	anchors: Record<string, PerformerArtworkAnchors>
	editMode: boolean
	focusedId: null | string
	isPlaying: boolean
	offsets: Record<string, PerformerOffset>
	onFocus: (id: string) => void
	onOffsetChange: (id: string, x: number, y: number) => void
	onScaleChange: (id: string, value: number) => void
	performers: Performer[]
	scales: Record<string, number>
}) {
	const placements = useMemo(() => layoutOrchestra(performers), [performers])

	return (
		<>
			<OrthographicCameraRig />
			<TheaterBackground />
			<Stage
				activeNotes={activeNotes}
				anchors={anchors}
				editMode={editMode}
				focusedId={focusedId}
				isPlaying={isPlaying}
				offsets={offsets}
				onFocus={onFocus}
				onOffsetChange={onOffsetChange}
				onScaleChange={onScaleChange}
				performers={performers}
				placements={placements}
				scales={scales}
			/>
		</>
	)
}

/**
 * Keeps the orthographic camera's zoom in step with the canvas size so the
 * stage stays the same apparent size on resize. The math mirrors the cover
 * calculation used by the background plane.
 */
function OrthographicCameraRig() {
	const camera = useThree(state => state.camera) as OrthographicCameraImpl
	const size = useThree(state => state.size)

	useLayoutEffect(() => {
		const { zoom } = computeWorldViewport(size)
		if (camera.zoom !== zoom) {
			camera.zoom = zoom
			camera.updateProjectionMatrix()
		}
	}, [camera, size])

	return null
}

function Stage({
	activeNotes,
	anchors,
	editMode,
	focusedId,
	isPlaying,
	offsets,
	onFocus,
	onOffsetChange,
	onScaleChange,
	performers,
	placements,
	scales,
}: {
	activeNotes: Map<string, number>
	anchors: Record<string, PerformerArtworkAnchors>
	editMode: boolean
	focusedId: null | string
	isPlaying: boolean
	offsets: Record<string, PerformerOffset>
	onFocus: (id: string) => void
	onOffsetChange: (id: string, x: number, y: number) => void
	onScaleChange: (id: string, value: number) => void
	performers: Performer[]
	placements: Map<string, StagePlacement>
	scales: Record<string, number>
}) {
	return (
		<group>
			{performers.map((performer) => {
				const placement = placements.get(performer.id)
				if (!placement) {
					return null
				}

				const muted = focusedId !== null && performer.id !== focusedId
				const anchorsForPerformer = getPerformerAnchors(performer, anchors)
				const scale = getPerformerScale(performer, scales)
				const offset = getPerformerOffset(performer, offsets)
				const finalPosition: [number, number, number] = [
					placement.position[0] + offset.x,
					placement.position[1] + offset.y,
					placement.position[2],
				]

				return (
					<PerformerModel
						active={activeNotes.get(performer.id) ?? 0}
						anchors={anchorsForPerformer}
						depthScale={placement.scale}
						editMode={editMode}
						isPlaying={isPlaying}
						key={performer.id}
						muted={muted}
						onFocus={() => onFocus(performer.id)}
						onMove={(x, y) => onOffsetChange(performer.id, x, y)}
						onResize={value => onScaleChange(performer.id, value)}
						performer={performer}
						position={finalPosition}
						renderOrder={placement.renderOrder}
						scale={scale}
						showAnchors={editMode && performer.id === focusedId}
						startOffset={offset}
					/>
				)
			})}
		</group>
	)
}

function PerformerModel({
	active,
	anchors,
	depthScale,
	editMode,
	isPlaying,
	muted,
	onFocus,
	onMove,
	onResize,
	performer,
	position,
	renderOrder,
	scale,
	showAnchors,
	startOffset,
}: {
	active: number
	anchors: PerformerArtworkAnchors
	/** Scale derived from depth (front rows render larger). */
	depthScale: number
	editMode: boolean
	isPlaying: boolean
	muted: boolean
	onFocus: () => void
	onMove: (x: number, y: number) => void
	onResize: (value: number) => void
	performer: Performer
	position: [number, number, number]
	renderOrder: number
	scale: number
	showAnchors: boolean
	startOffset: PerformerOffset
}) {
	const groupRef = useRef<Group>(null)
	const { texture: avatarTexture } = useCharacterArtwork(performer)
	const camera = useThree(state => state.camera)
	const gl = useThree(state => state.gl)
	const performerDepth = position[2]
	const effectiveScale = scale * depthScale
	const noteOrigin = anchorToLocalPosition(anchors)

	// Refs so the window listeners always see the latest values without
	// having to re-attach on every render.
	const editModeRef = useRef(editMode)
	const scaleRef = useRef(scale)
	const startOffsetRef = useRef(startOffset)
	editModeRef.current = editMode
	scaleRef.current = scale
	startOffsetRef.current = startOffset

	useFrame(({ clock }) => {
		if (!groupRef.current) {
			return
		}
		const isActive = isPlaying && active > 0
		const sway = isActive ? Math.sin(clock.elapsedTime * 1.8 + position[0]) * 0.1 : 0
		const bounce = isActive ? 1 + Math.sin(clock.elapsedTime * 16) * 0.06 + 0.08 : 1
		groupRef.current.rotation.z = sway
		const squashY = isActive ? 1 / bounce : 1
		groupRef.current.scale.set(effectiveScale * bounce, effectiveScale * squashY, 1)
	})

	const handlePointerDown = useCallback((event: { clientX: number, clientY: number, stopPropagation: () => void }) => {
		event.stopPropagation()

		if (!editModeRef.current) {
			onFocus()
			return
		}

		const canvas = gl.domElement
		const start = pointerToWorld(camera, canvas, event.clientX, event.clientY, performerDepth)
		if (!start) {
			return
		}
		const offsetAtStart = { ...startOffsetRef.current }
		let didMove = false

		const handleMove = (moveEvent: PointerEvent) => {
			const current = pointerToWorld(camera, canvas, moveEvent.clientX, moveEvent.clientY, performerDepth)
			if (!current) {
				return
			}
			didMove = true
			onMove(
				offsetAtStart.x + (current.x - start.x),
				offsetAtStart.y + (current.y - start.y),
			)
		}

		const handleUp = () => {
			window.removeEventListener('pointermove', handleMove)
			window.removeEventListener('pointerup', handleUp)
			window.removeEventListener('pointercancel', handleUp)
			// Treat a press without drag as a focus click, mirroring the
			// behavior outside edit mode for discoverability.
			if (!didMove) {
				onFocus()
			}
		}

		window.addEventListener('pointermove', handleMove)
		window.addEventListener('pointerup', handleUp)
		window.addEventListener('pointercancel', handleUp)
	}, [camera, gl, onFocus, onMove, performerDepth])

	const handleWheel = useCallback((event: { deltaY: number, stopPropagation: () => void }) => {
		if (!editModeRef.current) {
			return
		}
		event.stopPropagation()
		const factor = event.deltaY > 0 ? 1 / 1.06 : 1.06
		onResize(clampScale(scaleRef.current * factor))
	}, [onResize])

	return (
		<group position={position}>
			<group ref={groupRef}>
				<mesh onPointerDown={handlePointerDown} onWheel={handleWheel} renderOrder={renderOrder}>
					<planeGeometry args={[characterBaseWidth, characterBaseHeight]} />
					<meshBasicMaterial alphaTest={0.05} depthWrite={false} map={avatarTexture} opacity={muted ? 0.36 : 1} transparent />
				</mesh>
				{showAnchors ? <CharacterAnchorGuides anchors={anchors} renderOrder={renderOrder + 2} /> : null}
			</group>
			<FloatingNotes accent={performer.accent} active={muted ? 0 : active} isPlaying={isPlaying} origin={noteOrigin} renderOrder={renderOrder + 1} />
		</group>
	)
}

function CharacterAnchorGuides({ anchors, renderOrder }: { anchors: PerformerArtworkAnchors, renderOrder: number }) {
	const centerX = (anchors.centerX - 0.5) * characterBaseWidth
	const headY = (0.5 - anchors.headY) * characterBaseHeight
	const footY = (0.5 - anchors.footY) * characterBaseHeight

	return (
		<group position={[0, 0, 0.02]}>
			<mesh position={[centerX, 0, 0]} renderOrder={renderOrder}>
				<planeGeometry args={[0.018, characterBaseHeight]} />
				<meshBasicMaterial color="#75d7c4" depthTest={false} depthWrite={false} opacity={0.78} transparent />
			</mesh>
			<mesh position={[0, headY, 0]} renderOrder={renderOrder}>
				<planeGeometry args={[characterBaseWidth, 0.018]} />
				<meshBasicMaterial color="#ffcf70" depthTest={false} depthWrite={false} opacity={0.72} transparent />
			</mesh>
			<mesh position={[0, footY, 0]} renderOrder={renderOrder}>
				<planeGeometry args={[characterBaseWidth, 0.018]} />
				<meshBasicMaterial color="#ff8da1" depthTest={false} depthWrite={false} opacity={0.72} transparent />
			</mesh>
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
		const artworkSource = getPerformerArtworkSource(performer.category)
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
			drawContainImage(ctx, image, artwork.canvas.width, getPerformerArtworkScale(artworkSource))
			artwork.texture.needsUpdate = true
		}
		image.onerror = () => {
			if (!cancelled) {
				drawFallbackCharacter(ctx, artwork.canvas.width, performer)
				artwork.texture.needsUpdate = true
			}
		}
		if (artworkSource) {
			image.src = artworkSource.src
		}

		return () => {
			cancelled = true
		}
	}, [artwork, performer])

	return { texture: artwork.texture }
}

function drawContainImage(context: CanvasRenderingContext2D, image: HTMLImageElement, size: number, artworkScale = 1) {
	const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight) * artworkScale
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

function formatTime(seconds: number) {
	const minutes = Math.floor(seconds / 60)
	const remaining = Math.floor(seconds % 60).toString().padStart(2, '0')
	return `${minutes}:${remaining}`
}
