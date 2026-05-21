import type { InstrumentCategory } from './instrument-category'
import type { Song } from './song'

import { Midi } from '@tonejs/midi'

import { categorize } from './instrument-category'
import { songFromMidi } from './midi-parse'

export async function songFromMusicXml(source: ArrayBuffer | string, fileName: string): Promise<Song> {
	const [{ VerovioToolkit }, { default: createVerovioModule }] = await Promise.all([
		import('verovio/esm'),
		import('verovio/wasm'),
	])
	const VerovioModule = await createVerovioModule()
	const toolkit = new VerovioToolkit(VerovioModule)

	try {
		toolkit.setOptions({
			midiNoCue: true,
			xmlIdChecksum: true,
		})

		const loaded = typeof source === 'string'
			? toolkit.loadData(source)
			: toolkit.loadZipDataBuffer(source)
		if (!loaded) {
			throw new Error('Verovio could not load this MusicXML file.')
		}

		const meiSource = toolkit.getMEI()
		const staffsByCategory = buildStaffCategoryMap(meiSource)

		const midiBinary = base64ToArrayBuffer(toolkit.renderToMIDI())
		const midi = new Midi(midiBinary)
		return {
			...songFromMidi(midi, fileName, midiBinary),
			scoreSource: {
				kind: 'mei',
				source: meiSource,
				staffsByCategory,
			},
		}
	}
	finally {
		toolkit.destroy()
	}
}

/**
 * Convert a MusicXML string (e.g. produced by `webmscore` from a MIDI file)
 * into a Verovio-ready `scoreSource`. We don't return a full `Song` here
 * because the caller already has authoritative performers / MIDI from the
 * original input.
 */
export async function scoreSourceFromMusicXml(source: string): Promise<NonNullable<Song['scoreSource']> | null> {
	const [{ VerovioToolkit }, { default: createVerovioModule }] = await Promise.all([
		import('verovio/esm'),
		import('verovio/wasm'),
	])
	const VerovioModule = await createVerovioModule()
	const toolkit = new VerovioToolkit(VerovioModule)

	try {
		toolkit.setOptions({
			midiNoCue: true,
			xmlIdChecksum: true,
		})
		if (!toolkit.loadData(source)) {
			return null
		}
		const meiSource = toolkit.getMEI()
		return {
			kind: 'mei',
			source: meiSource,
			staffsByCategory: buildStaffCategoryMap(meiSource),
		}
	}
	catch {
		return null
	}
	finally {
		toolkit.destroy()
	}
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
	const binary = window.atob(value)
	const bytes = new Uint8Array(binary.length)

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index)
	}

	return bytes.buffer
}

/**
 * Walk the MEI <staffDef> elements and bucket their `@n` ids by inferred
 * `InstrumentCategory`. The category is derived from the embedded GM program /
 * channel on `<instrDef>` when present, falling back to a label keyword match
 * and finally to `piano`. The result lets us hide every staff that doesn't
 * belong to the focused performer at render time.
 */
function buildStaffCategoryMap(mei: string): Partial<Record<InstrumentCategory, string[]>> {
	const result: Partial<Record<InstrumentCategory, string[]>> = {}

	let doc: Document
	try {
		doc = new DOMParser().parseFromString(mei, 'application/xml')
	}
	catch {
		return result
	}
	if (doc.getElementsByTagName('parsererror').length > 0) {
		return result
	}

	const staffDefs = Array.from(doc.getElementsByTagNameNS('*', 'staffDef'))
	for (const staffDef of staffDefs) {
		const n = staffDef.getAttribute('n')
		if (!n) {
			continue
		}
		const category = inferStaffCategory(staffDef)
		const bucket = result[category] ?? []
		bucket.push(n)
		result[category] = bucket
	}

	return result
}

function inferStaffCategory(staffDef: Element): InstrumentCategory {
	const instrDef = staffDef.getElementsByTagNameNS('*', 'instrDef')[0]
	if (instrDef) {
		// MEI / MusicXML emit MIDI numbers as 1-indexed (1–128); categorize()
		// works against the 0-indexed GM program space (0–127), so shift here.
		const rawProgram = Number.parseInt(instrDef.getAttribute('midi.instrnum') ?? '', 10)
		const program = Number.isFinite(rawProgram) ? Math.max(0, rawProgram - 1) : Number.NaN
		// midi.channel is 1-indexed (1–16); categorize() expects 0-indexed.
		const rawChannel = Number.parseInt(instrDef.getAttribute('midi.channel') ?? '', 10)
		const channel = Number.isFinite(rawChannel) ? rawChannel - 1 : 0
		if (Number.isFinite(program)) {
			return categorize(program, channel)
		}
	}

	const label = staffDef.getElementsByTagNameNS('*', 'label')[0]?.textContent?.toLowerCase().trim() ?? ''
	if (label) {
		const keywordHit = categoryFromLabel(label)
		if (keywordHit) {
			return keywordHit
		}
	}

	return 'piano'
}

function categoryFromLabel(label: string): InstrumentCategory | undefined {
	const table: ReadonlyArray<readonly [string, InstrumentCategory]> = [
		['piano', 'piano'],
		['harpsichord', 'piano'],
		['clavinet', 'piano'],
		['organ', 'organ'],
		['accordion', 'organ'],
		['guitar', 'guitar'],
		['bass', 'bass'],
		['violin', 'strings'],
		['viola', 'strings'],
		['cello', 'strings'],
		['contrabass', 'strings'],
		['harp', 'strings'],
		['string', 'strings'],
		['choir', 'choir'],
		['voice', 'choir'],
		['vocal', 'choir'],
		['trumpet', 'brass'],
		['trombone', 'brass'],
		['horn', 'brass'],
		['tuba', 'brass'],
		['brass', 'brass'],
		['sax', 'reed'],
		['clarinet', 'reed'],
		['oboe', 'reed'],
		['bassoon', 'reed'],
		['flute', 'flute'],
		['piccolo', 'flute'],
		['recorder', 'flute'],
		['whistle', 'flute'],
		['drum', 'percussion'],
		['perc', 'percussion'],
		['timpani', 'percussion'],
		['synth', 'synth'],
		['lead', 'synth'],
		['pad', 'synth'],
		['marimba', 'mallet'],
		['vibraphone', 'mallet'],
		['xylophone', 'mallet'],
		['glockenspiel', 'mallet'],
	]
	for (const [keyword, category] of table) {
		if (label.includes(keyword)) {
			return category
		}
	}
	return undefined
}
