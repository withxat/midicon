import type { Song } from '../song'
import type { AudioEngine } from './types'

import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib'

import { SoundFont } from './soundfont'
import { localSoundFontPath, signalSoundFontUrl } from './soundfont-sources'

const workletPath = '/spessasynth/spessasynth_processor.min.js'

export class SpessaSynthEngine implements AudioEngine {
	readonly kind = 'spessasynth' as const
	readonly hasNativeLoop = true

	private context: AudioContext | null = null
	private currentSongKey: null | string = null
	private loopEnabled = false
	private sequencer: null | Sequencer = null
	private speed = 1
	private synth: null | WorkletSynthesizer = null
	private workletAdded = false

	constructor(
		private readonly soundFontSources = [localSoundFontPath, signalSoundFontUrl],
	) {}

	async load() {
		this.context ??= new AudioContext()

		if (!this.workletAdded) {
			await this.context.audioWorklet.addModule(workletPath)
			this.workletAdded = true
		}

		this.synth ??= new WorkletSynthesizer(this.context)
		this.synth.connect(this.context.destination)
		this.sequencer ??= new Sequencer(this.synth)
		this.sequencer.loopCount = this.loopEnabled ? -1 : 0
		this.sequencer.playbackRate = this.speed
		this.sequencer.skipToFirstNoteOn = false

		const soundFont = await loadFirstSoundFont(this.soundFontSources)
		await this.synth.soundBankManager.addSoundBank(soundFont.data.slice(0), 'main')
		await this.synth.isReady
	}

	async loadSong(song: Song) {
		if (!this.sequencer || !this.synth) {
			throw new Error('SpessaSynthEngine is not loaded')
		}
		if (!song.midiBinary) {
			throw new Error('Song has no MIDI binary; build one before loading.')
		}

		const key = `${song.fileName}|${song.midiBinary.byteLength}`
		if (key === this.currentSongKey) {
			this.synth.stopAll(false)
			this.sequencer.pause()
			this.sequencer.currentTime = 0
			return
		}

		this.synth.stopAll(true)
		this.sequencer.loadNewSongList([{ binary: song.midiBinary, fileName: song.fileName }])
		this.sequencer.pause()
		this.sequencer.playbackRate = this.speed
		this.sequencer.loopCount = this.loopEnabled ? -1 : 0
		this.sequencer.currentTime = 0
		this.currentSongKey = key
	}

	async play() {
		if (!this.context || !this.sequencer) {
			return
		}
		await this.context.resume()
		this.sequencer.play()
	}

	pause() {
		this.sequencer?.pause()
		this.synth?.stopAll(false)
	}

	seek(time: number) {
		if (!this.sequencer) {
			return
		}
		this.synth?.stopAll(false)
		this.sequencer.currentTime = time
	}

	setLoop(enabled: boolean) {
		this.loopEnabled = enabled
		if (this.sequencer) {
			this.sequencer.loopCount = enabled ? -1 : 0
		}
	}

	setSpeed(speed: number) {
		this.speed = speed
		if (this.sequencer) {
			this.sequencer.playbackRate = speed
		}
	}

	dispose() {
		this.sequencer = null
		this.synth?.destroy()
		this.synth = null
		void this.context?.close()
		this.context = null
		this.workletAdded = false
		this.currentSongKey = null
	}
}

async function loadFirstSoundFont(sources: string[]) {
	let lastError: unknown
	for (const source of sources) {
		try {
			return await SoundFont.loadFromURL(source)
		}
		catch (error) {
			lastError = error
		}
	}
	throw lastError
}
