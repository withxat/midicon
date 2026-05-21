declare module 'verovio/wasm' {
	export default function createVerovioModule(): Promise<unknown>
}

declare module 'verovio/esm' {
	export class VerovioToolkit {
		constructor(module: unknown)
		destroy(): void
		getMEI(options?: Record<string, unknown>): string
		getPageCount(): number
		getVersion(): string
		loadData(data: string): boolean
		loadZipDataBuffer(data: ArrayBuffer): boolean
		redoLayout(options?: Record<string, unknown>): void
		renderToMIDI(): string
		renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string
		renderToTimemap(options?: Record<string, unknown>): unknown
		setOptions(options: Record<string, unknown>): void
	}
}
