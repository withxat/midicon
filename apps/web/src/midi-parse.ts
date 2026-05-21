import type { InstrumentCategory } from './instrument-category'
import type { NoteEvent, Performer, Song, TrackSource } from './song'

import { Midi } from '@tonejs/midi'

import { categorize, categoryById } from './instrument-category'

export function songFromMidi(midi: Midi, fileName: string, midiBinary?: ArrayBuffer): Song {
	const sources: TrackSource[] = []

	for (const [index, track] of midi.tracks.entries()) {
		if (track.notes.length === 0) {
			continue
		}
		sources.push({
			channel: track.channel,
			name: track.name || track.instrument.name || `Track ${index + 1}`,
			notes: track.notes.map(note => ({
				duration: Math.max(note.duration, 0.08),
				midi: note.midi,
				name: note.name,
				time: note.time,
				velocity: Math.max(note.velocity, 0.35),
			})),
			program: track.instrument.number,
		})
	}

	return {
		bpm: midi.header.tempos[0]?.bpm ?? 120,
		duration: Math.max(midi.duration, 1),
		fileName,
		midiBinary,
		performers: groupTracksIntoPerformers(sources),
	}
}

/**
 * Collapse a list of raw MIDI tracks into one `Performer` per instrument
 * category. Notes from every source track in the category get merged and
 * time-sorted so a single visible character represents e.g. all the piano
 * tracks in the file.
 */
export function groupTracksIntoPerformers(tracks: TrackSource[]): Performer[] {
	const grouped = new Map<InstrumentCategory, TrackSource[]>()

	for (const track of tracks) {
		const category = categorize(track.program, track.channel)
		const bucket = grouped.get(category)
		if (bucket) {
			bucket.push(track)
		}
		else {
			grouped.set(category, [track])
		}
	}

	const performers: Performer[] = []
	for (const [category, group] of grouped) {
		const def = categoryById[category]
		const notes: NoteEvent[] = []
		for (const track of group) {
			notes.push(...track.notes)
		}
		notes.sort((a, b) => a.time - b.time)

		const name = group.length === 1
			? group[0]!.name
			: `${def.label} · ${group.length} parts`

		performers.push({
			accent: def.accent,
			category,
			id: `category-${category}`,
			name,
			notes,
			tracks: group,
		})
	}

	performers.sort((a, b) => categoryById[a.category].order - categoryById[b.category].order)
	return performers
}

/** Build a MIDI binary from in-memory performers (e.g. the demo song) so the Sequencer can play it. */
export function buildMidiBinary(song: Song): ArrayBuffer {
	const midi = new Midi()
	midi.header.setTempo(song.bpm)

	for (const performer of song.performers) {
		for (const source of performer.tracks) {
			const track = midi.addTrack()
			track.channel = source.channel
			track.instrument.number = source.program
			track.name = source.name
			for (const note of source.notes) {
				track.addNote({
					duration: Math.max(note.duration, 0.05),
					midi: note.midi,
					time: note.time,
					velocity: Math.min(Math.max(note.velocity, 0), 1),
				})
			}
		}
	}

	const bytes = midi.toArray()
	const copy = new ArrayBuffer(bytes.byteLength)
	new Uint8Array(copy).set(bytes)
	return copy
}

/** Ensure a Song has a `midiBinary` payload. Returns the same Song if it already has one. */
export function withMidiBinary(song: Song): Song {
	if (song.midiBinary) {
		return song
	}
	return { ...song, midiBinary: buildMidiBinary(song) }
}
