import type { InstrumentCategory } from '../instrument-category'
import type { Song } from '../song'
import type { AudioEngine } from './types'

import * as Tone from 'tone'

function createSynth(category: InstrumentCategory) {
	switch (category) {
		case 'bass':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.01, decay: 0.12, release: 0.18, sustain: 0.35 },
				oscillator: { type: 'sawtooth' },
			})
		case 'flute':
		case 'reed':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.04, decay: 0.18, release: 0.32, sustain: 0.7 },
				oscillator: { type: 'sine' },
			})
		case 'guitar':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.005, decay: 0.18, release: 0.16, sustain: 0.18 },
				oscillator: { type: 'triangle' },
			})
		case 'percussion':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.001, decay: 0.08, release: 0.04, sustain: 0.02 },
				oscillator: { type: 'square' },
			})
		case 'brass':
		case 'synth':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.01, decay: 0.12, release: 0.22, sustain: 0.32 },
				oscillator: { type: 'sawtooth' },
			})
		case 'strings':
		case 'choir':
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.08, decay: 0.22, release: 0.5, sustain: 0.78 },
				oscillator: { type: 'fatsine' },
			})
		default:
			return new Tone.PolySynth(Tone.Synth, {
				envelope: { attack: 0.01, decay: 0.1, release: 0.24, sustain: 0.28 },
				oscillator: { type: 'fatsine' },
			})
	}
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

export class ToneEngine implements AudioEngine {
	readonly kind = 'tone' as const
	readonly hasNativeLoop = false

	private offset = 0
	private song: null | Song = null
	private speed = 1
	private synths: Tone.PolySynth<Tone.Synth>[] = []

	async load() {
		await Tone.start()
	}

	async loadSong(song: Song) {
		this.tearDown()
		this.song = song
		this.offset = 0
	}

	async play() {
		await Tone.start()
		if (!this.song) {
			return
		}
		if (Tone.Transport.state === 'paused') {
			Tone.Transport.start()
			return
		}
		this.tearDown()
		this.scheduleFrom(this.offset)
		Tone.Transport.start('+0', 0)
	}

	pause() {
		if (Tone.Transport.state === 'started') {
			Tone.Transport.pause()
		}
		for (const synth of this.synths) {
			synth.releaseAll()
		}
	}

	seek(time: number) {
		const wasPlaying = Tone.Transport.state === 'started'
		this.tearDown()
		this.offset = time
		if (wasPlaying && this.song) {
			this.scheduleFrom(time)
			Tone.Transport.start('+0', 0)
		}
	}

	setLoop(_enabled: boolean) {
		// No native loop; the app layer wraps via seek(0) + play().
	}

	setSpeed(speed: number) {
		if (this.speed === speed) {
			return
		}
		const wasPlaying = Tone.Transport.state === 'started'
		const elapsed = Tone.Transport.seconds
		this.speed = speed
		if (wasPlaying && this.song) {
			const reachedTime = this.offset + elapsed * (this.speed === 0 ? 0 : this.speed / speed)
			this.tearDown()
			this.offset = reachedTime
			this.scheduleFrom(reachedTime)
			Tone.Transport.start('+0', 0)
		}
	}

	dispose() {
		this.tearDown()
		this.song = null
	}

	private scheduleFrom(offset: number) {
		if (!this.song) {
			return
		}
		const speed = this.speed
		const synths = this.song.performers.map(performer => createSynth(performer.category).toDestination())
		this.synths = synths

		for (const [index, performer] of this.song.performers.entries()) {
			const synth = synths[index]!
			const isDrums = performer.category === 'percussion'
			for (const note of performer.notes) {
				if (note.time + note.duration < offset) {
					continue
				}
				Tone.Transport.schedule((scheduledTime) => {
					const pitch = isDrums ? drumPitch(note.midi) : note.name
					synth.triggerAttackRelease(pitch, Math.max(note.duration / speed, 0.08), scheduledTime, note.velocity)
				}, Math.max((note.time - offset) / speed, 0))
			}
		}
	}

	private tearDown() {
		Tone.Transport.stop()
		Tone.Transport.cancel(0)
		for (const synth of this.synths) {
			synth.dispose()
		}
		this.synths = []
	}
}
