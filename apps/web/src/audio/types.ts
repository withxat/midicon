import type { Song } from '../song'

export type EngineKind = 'spessasynth' | 'tone'

export interface AudioEngine {
	dispose: () => void
	/** True when the engine loops audio internally without app intervention. */
	readonly hasNativeLoop: boolean
	kind: EngineKind
	/** Initialize the audio context, worklet, and (for SpessaSynth) the sound bank. */
	load: () => Promise<void>
	/** Swap to a new song. Resets internal position to 0. */
	loadSong: (song: Song) => Promise<void>
	/** Pause playback while preserving the current position (notes release naturally). */
	pause: () => void
	/** Resume / start playing from the current position. */
	play: () => Promise<void>
	/** Jump to a new position. Works whether playing or paused. */
	seek: (time: number) => void
	/** Enable/disable looping at the audio engine layer. */
	setLoop: (enabled: boolean) => void
	/** Set playback speed multiplier. */
	setSpeed: (speed: number) => void
}
