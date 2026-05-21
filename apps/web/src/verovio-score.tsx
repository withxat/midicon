import type { CSSProperties } from 'react'
import type { VerovioToolkit as VerovioToolkitType } from 'verovio/esm'

import type { Song } from './song'

import { useEffect, useMemo, useRef, useState } from 'react'

interface TimemapEntry {
	measureOn?: string
	off?: string[]
	on?: string[]
	restsOff?: string[]
	restsOn?: string[]
	tstamp: number
}

interface PlaybackEntry extends TimemapEntry {
	notesOn: string[]
}

interface HighlightedElement {
	domid: string
	fill: null | string
	stroke: null | string
}

export function VerovioScore({
	accent,
	currentTime,
	scoreSource,
}: {
	accent: string
	currentTime: number
	scoreSource: NonNullable<Song['scoreSource']>
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const eventsRef = useRef<PlaybackEntry[]>([])
	const highlightedRef = useRef<HighlightedElement[]>([])
	const [renderState, setRenderState] = useState<'error' | 'loading' | 'ready'>('loading')

	const highlightStyle = useMemo(() => ({
		'--score-accent': accent,
	}) as CSSProperties, [accent])

	useEffect(() => {
		const container = containerRef.current
		if (!container) {
			return
		}
		const scoreContainer = container

		let cancelled = false
		let toolkit: null | VerovioToolkitType = null
		let resizeObserver: null | ResizeObserver = null

		async function render() {
			setRenderState('loading')
			try {
				const [{ VerovioToolkit }, { default: createVerovioModule }] = await Promise.all([
					import('verovio/esm'),
					import('verovio/wasm'),
				])
				const VerovioModule = await createVerovioModule()
				if (cancelled) {
					return
				}

				toolkit = new VerovioToolkit(VerovioModule)
				const loaded = typeof scoreSource.source === 'string'
					? toolkit.loadData(scoreSource.source)
					: toolkit.loadZipDataBuffer(scoreSource.source)
				if (!loaded) {
					throw new Error('Verovio could not load the score.')
				}

				const redraw = () => {
					if (!toolkit || cancelled) {
						return
					}

					const rect = scoreContainer.getBoundingClientRect()
					toolkit.setOptions({
						adjustPageHeight: true,
						breaks: 'smart',
						font: 'Bravura',
						footer: 'none',
						pageHeight: Math.max(320, rect.height) * 2,
						pageWidth: Math.max(320, rect.width) * 2,
						scale: 50,
						spacingLinear: 0.25,
						spacingNonLinear: 0.6,
					})
					toolkit.redoLayout({ resetCache: false })

					const pages: string[] = []
					for (let page = 1; page <= toolkit.getPageCount(); page += 1) {
						pages.push(toolkit.renderToSVG(page))
					}

					const timemap = toolkit.renderToTimemap({
						includeMeasures: true,
						includeRests: true,
					}) as TimemapEntry[]

					scoreContainer.innerHTML = pages.map((svg, index) => `<div class="verovio-score-page" data-page="${index + 1}">${svg}</div>`).join('')
					for (const svg of scoreContainer.querySelectorAll('svg')) {
						svg.setAttribute('width', '100%')
						svg.removeAttribute('height')
					}
					eventsRef.current = buildPlaybackEntries(timemap)
					highlightedRef.current = []
					setRenderState('ready')
				}

				redraw()
				resizeObserver = new ResizeObserver(redraw)
				resizeObserver.observe(scoreContainer)
			}
			catch {
				if (!cancelled) {
					scoreContainer.innerHTML = ''
					eventsRef.current = []
					highlightedRef.current = []
					setRenderState('error')
				}
			}
		}

		void render()

		return () => {
			cancelled = true
			resizeObserver?.disconnect()
			toolkit?.destroy()
			restoreHighlighted(scoreContainer, highlightedRef.current)
			eventsRef.current = []
			highlightedRef.current = []
			scoreContainer.innerHTML = ''
		}
	}, [scoreSource])

	useEffect(() => {
		const container = containerRef.current
		const events = eventsRef.current
		if (!container || events.length === 0) {
			return
		}

		const event = eventAtTime(events, currentTime * 1000)
		restoreHighlighted(container, highlightedRef.current.filter(note => !event.notesOn.includes(note.domid)))
		highlightedRef.current = highlightedRef.current.filter(note => event.notesOn.includes(note.domid))

		for (const domid of event.notesOn) {
			if (highlightedRef.current.some(note => note.domid === domid)) {
				continue
			}

			const element = findScoreElement(container, domid)
			if (!element) {
				continue
			}

			highlightedRef.current.push({
				domid,
				fill: element.getAttribute('fill'),
				stroke: element.getAttribute('stroke'),
			})
			element.setAttribute('fill', accent)
			element.setAttribute('stroke', accent)
		}

		const target = event.notesOn[0] ? findScoreElement(container, event.notesOn[0]) : null
		target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
	}, [accent, currentTime])

	return (
		<div className="relative overflow-hidden rounded-lg bg-[#fff8e7] shadow-[inset_0_0_0_1px_rgba(43,38,51,0.1)]" style={highlightStyle}>
			<div className="h-[260px] overflow-auto px-3 py-4 max-md:h-52 [&_.verovio-score-page]:mx-auto [&_.verovio-score-page]:mb-4 [&_.verovio-score-page]:max-w-[980px] [&_svg]:block [&_svg]:h-auto" ref={containerRef} />
			{renderState === 'loading'
				? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#fff8e7] font-mono text-[0.75rem] font-bold text-[#2b2633]/72 uppercase">Engraving score…</div>
				: null}
			{renderState === 'error'
				? <div className="absolute inset-0 grid place-items-center bg-[#fff8e7] px-6 text-center font-mono text-[0.75rem] font-bold text-[#8d3c3c] uppercase">Verovio could not render this score.</div>
				: null}
		</div>
	)
}

function buildPlaybackEntries(timemap: TimemapEntry[]): PlaybackEntry[] {
	const entries: PlaybackEntry[] = []

	for (const entry of timemap) {
		const previousNotes = entries.at(-1)?.notesOn ?? []
		const off = new Set([...(entry.off ?? []), ...(entry.restsOff ?? [])])
		const notesOn = previousNotes.filter(domid => !off.has(domid))
		notesOn.push(...(entry.on ?? []), ...(entry.restsOn ?? []))

		entries.push({
			...entry,
			notesOn,
		})
	}

	return entries
}

function eventAtTime(events: PlaybackEntry[], timestamp: number): PlaybackEntry {
	let match = events[0]!
	for (const event of events) {
		if (event.tstamp > timestamp) {
			break
		}
		match = event
	}
	return match
}

function restoreHighlighted(container: HTMLElement, highlighted: HighlightedElement[]) {
	for (const note of highlighted) {
		const element = findScoreElement(container, note.domid)
		if (!element) {
			continue
		}
		if (note.fill) {
			element.setAttribute('fill', note.fill)
		}
		else {
			element.removeAttribute('fill')
		}
		if (note.stroke) {
			element.setAttribute('stroke', note.stroke)
		}
		else {
			element.removeAttribute('stroke')
		}
	}
}

function findScoreElement(container: HTMLElement, id: string) {
	return container.querySelector<SVGElement>(`#${window.CSS.escape(id)}`)
}
