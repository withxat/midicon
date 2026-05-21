import type { Song } from './song'

import { Midi } from '@tonejs/midi'

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

		const midiBinary = base64ToArrayBuffer(toolkit.renderToMIDI())
		const midi = new Midi(midiBinary)
		return {
			...songFromMidi(midi, fileName, midiBinary),
			scoreSource: {
				kind: 'musicxml',
				source,
			},
		}
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
