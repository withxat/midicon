/**
 * Source-of-truth taxonomy for routing MIDI program numbers + drum channel into
 * a small set of "character" categories. Each category gets one performer on
 * stage regardless of how many MIDI tracks feed it, so a 20-track orchestral
 * MIDI file collapses into ~8–10 visible characters.
 *
 * GM (General MIDI) program reference:
 *   https://www.midi.org/specifications-old/item/gm-level-1-sound-set
 */
export type InstrumentCategory
	= | 'bass'
		| 'brass'
		| 'choir'
		| 'ethnic'
		| 'flute'
		| 'guitar'
		| 'mallet'
		| 'organ'
		| 'percussion'
		| 'piano'
		| 'reed'
		| 'strings'
		| 'synth'

export interface CategoryDef {
	accent: string
	description: string
	examples: string[]
	/** Default GM program number when synthesising programmatically (demo song, etc.). */
	fallbackProgram: number
	/** Program ranges (inclusive) that route to this category. Drum kit is matched separately via channel 9. */
	gmRanges: ReadonlyArray<readonly [number, number]>
	id: InstrumentCategory
	imagePath: string
	label: string
	/** Display order on stage / in the performer list. */
	order: number
	/** Single iconic instrument used for character art generation. */
	representative: string
}

export const categories: CategoryDef[] = [
	{
		accent: '#ffcf70',
		description: 'Acoustic and electric pianos, harpsichord, clavinet — keyboard-driven melodic anchors.',
		examples: ['Acoustic grand piano', 'Electric piano', 'Harpsichord', 'Clavinet'],
		fallbackProgram: 0,
		gmRanges: [[0, 7]],
		id: 'piano',
		imagePath: '/characters/piano.png',
		label: 'Piano',
		order: 1,
		representative: 'Acoustic grand piano',
	},
	{
		accent: '#e8d57a',
		description: 'Pitched percussion struck with mallets — bright, bell-like timbres.',
		examples: ['Vibraphone', 'Marimba', 'Glockenspiel', 'Music box', 'Tubular bells'],
		fallbackProgram: 11,
		gmRanges: [[8, 15]],
		id: 'mallet',
		imagePath: '/characters/mallet.png',
		label: 'Mallet',
		order: 2,
		representative: 'Vibraphone',
	},
	{
		accent: '#f4b95a',
		description: 'Sustained, bellows-style keyboards: pipe organ, drawbar organ, accordion, harmonica.',
		examples: ['Church organ', 'Hammond organ', 'Accordion', 'Harmonica'],
		fallbackProgram: 19,
		gmRanges: [[16, 23]],
		id: 'organ',
		imagePath: '/characters/organ.png',
		label: 'Organ',
		order: 3,
		representative: 'Pipe organ',
	},
	{
		accent: '#75d7c4',
		description: 'Acoustic and electric guitars including clean, muted and distorted tones.',
		examples: ['Nylon guitar', 'Steel guitar', 'Electric clean', 'Overdriven guitar'],
		fallbackProgram: 25,
		gmRanges: [[24, 31]],
		id: 'guitar',
		imagePath: '/characters/guitar.png',
		label: 'Guitar',
		order: 4,
		representative: 'Electric guitar (Stratocaster body)',
	},
	{
		accent: '#7f8bff',
		description: 'Electric, acoustic, slap and synth basses — the low-end anchor.',
		examples: ['Electric bass (finger)', 'Acoustic bass', 'Slap bass', 'Synth bass'],
		fallbackProgram: 33,
		gmRanges: [[32, 39]],
		id: 'bass',
		imagePath: '/characters/bass.png',
		label: 'Bass',
		order: 5,
		representative: 'Electric bass guitar (Precision-style)',
	},
	{
		accent: '#a8b8ff',
		// Programs 40-46 are bowed strings + harp; 48-51 are string/synth string ensembles. 47 (timpani) is routed to percussion.
		description: 'Bowed and plucked strings: violin, viola, cello, contrabass, ensembles, harp.',
		examples: ['Violin', 'Viola', 'Cello', 'Contrabass', 'String ensemble', 'Harp', 'Pizzicato strings'],
		fallbackProgram: 48,
		gmRanges: [[40, 46], [48, 51]],
		id: 'strings',
		imagePath: '/characters/strings.png',
		label: 'Strings',
		order: 6,
		representative: 'Violin (with bow)',
	},
	{
		accent: '#f5b8d8',
		description: 'Vocal pads, choirs and orchestral stabs — non-instrumental voice tones.',
		examples: ['Choir aahs', 'Voice oohs', 'Synth voice', 'Orchestra hit'],
		fallbackProgram: 52,
		gmRanges: [[52, 55]],
		id: 'choir',
		imagePath: '/characters/choir.png',
		label: 'Choir',
		order: 7,
		representative: 'Vocalist holding a stand microphone',
	},
	{
		accent: '#ffb070',
		description: 'Brass family: trumpets, trombones, horns, tuba and ensemble brass.',
		examples: ['Trumpet', 'Trombone', 'Tuba', 'French horn', 'Brass section', 'Muted trumpet'],
		fallbackProgram: 56,
		gmRanges: [[56, 63]],
		id: 'brass',
		imagePath: '/characters/brass.png',
		label: 'Brass',
		order: 8,
		representative: 'Trumpet',
	},
	{
		accent: '#ffd25a',
		description: 'Reed instruments: saxophones, clarinet, oboe, bassoon, english horn.',
		examples: ['Soprano sax', 'Alto sax', 'Tenor sax', 'Baritone sax', 'Oboe', 'English horn', 'Bassoon', 'Clarinet'],
		fallbackProgram: 65,
		gmRanges: [[64, 71]],
		id: 'reed',
		imagePath: '/characters/reed.png',
		label: 'Reed',
		order: 9,
		representative: 'Tenor saxophone',
	},
	{
		accent: '#cdeaff',
		description: 'Pipe woodwinds: flute, piccolo, recorder, pan flute, whistle, ocarina, shakuhachi.',
		examples: ['Flute', 'Piccolo', 'Recorder', 'Pan flute', 'Whistle', 'Ocarina', 'Shakuhachi'],
		fallbackProgram: 73,
		gmRanges: [[72, 79]],
		id: 'flute',
		imagePath: '/characters/flute.png',
		label: 'Flute',
		order: 10,
		representative: 'Transverse concert flute',
	},
	{
		accent: '#c69bff',
		// 80-87 leads, 88-95 pads, 96-103 synth fx. Sound effects (120-127) are folded in here because they're rare and equally "non-acoustic".
		description: 'All synth voices: leads, pads, atmospheres and synth/sound effects.',
		examples: ['Synth lead', 'Synth pad', 'Atmospheric FX', 'Bird tweet', 'Helicopter'],
		fallbackProgram: 81,
		gmRanges: [[80, 103], [120, 127]],
		id: 'synth',
		imagePath: '/characters/synth.png',
		label: 'Synth',
		order: 11,
		representative: 'Vintage analog synthesizer with knobs (Moog-style)',
	},
	{
		accent: '#f29b6b',
		description: 'World / ethnic instruments: sitar, banjo, koto, shamisen, kalimba, bagpipes, fiddle.',
		examples: ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipes', 'Fiddle', 'Shanai'],
		fallbackProgram: 105,
		gmRanges: [[104, 111]],
		id: 'ethnic',
		imagePath: '/characters/ethnic.png',
		label: 'World',
		order: 12,
		representative: 'Sitar',
	},
	{
		accent: '#ff8da1',
		// Channel 9 (drum kit) handled in categorize(). Program 47 = Timpani is also routed here.
		description: 'Unpitched drum kit (MIDI channel 10) and tuned percussion like timpani, taiko, steel drums, agogo.',
		examples: ['Drum kit', 'Timpani', 'Taiko', 'Steel drum', 'Agogo', 'Woodblock'],
		fallbackProgram: 0,
		gmRanges: [[112, 119]],
		id: 'percussion',
		imagePath: '/characters/percussion.png',
		label: 'Percussion',
		order: 13,
		representative: 'Acoustic drum kit (snare, kick, hi-hat, crash)',
	},
]

export const categoryById: Record<InstrumentCategory, CategoryDef> = Object.fromEntries(
	categories.map(category => [category.id, category]),
) as Record<InstrumentCategory, CategoryDef>

/** Map a (program, channel) pair to one of our visible characters. */
export function categorize(program: number, channel: number): InstrumentCategory {
	if (channel === 9) {
		return 'percussion'
	}
	if (program === 47) {
		return 'percussion'
	}

	for (const category of categories) {
		for (const [start, end] of category.gmRanges) {
			if (program >= start && program <= end) {
				return category.id
			}
		}
	}

	return 'piano'
}

export function fallbackProgramFor(category: InstrumentCategory): number {
	return categoryById[category].fallbackProgram
}
