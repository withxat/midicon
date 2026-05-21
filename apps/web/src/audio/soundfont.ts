import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core'

export class SoundFont {
	constructor(
		readonly data: ArrayBuffer,
		readonly parsed: ReturnType<typeof SoundBankLoader.fromArrayBuffer>,
	) {}

	static async load(data: ArrayBuffer) {
		await BasicSoundBank.isSF3DecoderReady
		const parsed = SoundBankLoader.fromArrayBuffer(data)
		return new SoundFont(data, parsed)
	}

	static async loadFromURL(url: string) {
		const response = await fetch(url)
		if (!response.ok) {
			throw new Error(`Failed to load SoundFont (${response.status})`)
		}
		return SoundFont.load(await response.arrayBuffer())
	}
}
