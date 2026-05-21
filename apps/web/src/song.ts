import type { InstrumentCategory } from './instrument-category'

export interface NoteEvent {
	duration: number
	midi: number
	name: string
	time: number
	velocity: number
}

/**
 * One raw MIDI track collapsed into our internal shape. We keep these around
 * inside the merged `Performer` so we can rebuild the MIDI binary preserving
 * per-channel programs.
 */
export interface TrackSource {
	channel: number
	name: string
	notes: NoteEvent[]
	program: number
}

export interface Performer {
	accent: string
	category: InstrumentCategory
	id: string
	name: string
	/** Combined, time-sorted notes from every source track in this category. */
	notes: NoteEvent[]
	/** Source tracks that were merged into this performer. */
	tracks: TrackSource[]
}

export interface Song {
	bpm: number
	duration: number
	fileName: string
	/** Raw file bytes; SpessaSynth Sequencer plays this for full track fidelity. */
	midiBinary?: ArrayBuffer
	performers: Performer[]
	scoreSource?: {
		kind: 'musicxml'
		source: ArrayBuffer | string
	}
}

export const palette = ['#ffcf70', '#ff8da1', '#75d7c4', '#a8b8ff', '#f59ee6']
export const maxMidiFileSize = 5 * 1024 * 1024

export function midiToNoteName(midi: number) {
	const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
	const octave = Math.floor(midi / 12) - 1
	return `${names[midi % 12]}${octave}`
}
