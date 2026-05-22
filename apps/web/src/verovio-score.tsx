import type { CSSProperties } from 'react'
import type { VerovioToolkit as VerovioToolkitType } from 'verovio/esm'

import type { InstrumentCategory } from './instrument-category'
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

interface MeasureEntry {
	measureId: string
	tstamp: number
}

interface HighlightedElement {
	domid: string
	fill: null | string
	stroke: null | string
}

export function VerovioScore({
	accent,
	currentTime,
	focusedCategory,
	scoreSource,
}: {
	accent: string
	currentTime: number
	focusedCategory: InstrumentCategory | null
	scoreSource: NonNullable<Song['scoreSource']>
}) {
	const containerRef = useRef<HTMLDivElement>(null)
	const eventsRef = useRef<PlaybackEntry[]>([])
	const highlightedRef = useRef<HighlightedElement[]>([])
	const measuresRef = useRef<MeasureEntry[]>([])
	const toolkitRef = useRef<null | VerovioToolkitType>(null)
	const [renderState, setRenderState] = useState<'error' | 'loading' | 'ready'>('loading')
	const [toolkitVersion, setToolkitVersion] = useState(0)

	const highlightStyle = useMemo(() => ({
		'--score-accent': accent,
	}) as CSSProperties, [accent])

	useEffect(() => {
		const container = containerRef.current
		if (!container) {
			return
		}

		let cancelled = false

		async function init() {
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
				toolkitRef.current = new VerovioToolkit(VerovioModule)
				setToolkitVersion(version => version + 1)
			}
			catch {
				if (!cancelled) {
					setRenderState('error')
				}
			}
		}

		void init()

		return () => {
			cancelled = true
			toolkitRef.current?.destroy()
			toolkitRef.current = null
			restoreHighlighted(container, highlightedRef.current)
			eventsRef.current = []
			measuresRef.current = []
			highlightedRef.current = []
			container.innerHTML = ''
		}
	}, [])

	useEffect(() => {
		const container = containerRef.current
		const toolkit = toolkitRef.current
		if (!container || !toolkit) {
			return
		}
		const scoreContainer = container

		let cancelled = false
		let resizeObserver: null | ResizeObserver = null
		const scheduleRenderState = (state: 'error' | 'loading' | 'ready') => {
			queueMicrotask(() => {
				if (!cancelled) {
					setRenderState(state)
				}
			})
		}

		const meiSource = filterMeiByCategory(scoreSource.source, scoreSource.staffsByCategory, focusedCategory)

		try {
			const loaded = toolkit.loadData(meiSource)
			if (!loaded) {
				throw new Error('Verovio could not load the score.')
			}
		}
		catch {
			scoreContainer.innerHTML = ''
			eventsRef.current = []
			measuresRef.current = []
			highlightedRef.current = []
			scheduleRenderState('error')
			return
		}

		const redraw = () => {
			if (cancelled) {
				return
			}

			const rect = scoreContainer.getBoundingClientRect()
			const measureCount = Math.max(estimateMeasureCount(toolkit.renderToTimemap({
				includeMeasures: true,
				includeRests: true,
			}) as TimemapEntry[]), 1)
			const scoreWidth = Math.max(rect.width * 1.35, measureCount * 210)
			const scale = 50
			toolkit.setOptions({
				adjustPageHeight: true,
				breaks: 'none',
				font: 'Bravura',
				footer: 'none',
				// Use a very tall page so adjustPageHeight crops to the
				// score's natural content height instead of compressing
				// every staff into a fixed container height.
				pageHeight: 60000,
				pageWidth: (scoreWidth * 100) / scale,
				scale,
				spacingLinear: 0.05,
				spacingNonLinear: 0.95,
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
				const width = svg.getAttribute('width')
				const height = svg.getAttribute('height')
				if (width && height) {
					svg.setAttribute('viewBox', `0 0 ${width.replace('px', '')} ${height.replace('px', '')}`)
				}
			}
			eventsRef.current = buildPlaybackEntries(timemap)
			measuresRef.current = buildMeasureEntries(timemap)
			highlightedRef.current = []
			scheduleRenderState('ready')
		}

		redraw()
		resizeObserver = new ResizeObserver(redraw)
		resizeObserver.observe(scoreContainer)

		return () => {
			cancelled = true
			resizeObserver?.disconnect()
		}
	}, [focusedCategory, scoreSource, toolkitVersion])

	useEffect(() => {
		const container = containerRef.current
		const events = eventsRef.current
		const measures = measuresRef.current
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
		const fallbackTarget = measures.length ? findScoreElement(container, measureAtTime(measures, currentTime * 1000).measureId) : null
		scrollHorizontallyTo(container, target ?? fallbackTarget)
	}, [accent, currentTime])

	return (
		<div className="relative overflow-hidden rounded-lg bg-[#fff8e7] shadow-[inset_0_0_0_1px_rgba(43,38,51,0.1)]" style={highlightStyle}>
			<div className="min-h-[220px] overflow-x-auto overflow-y-hidden px-3 py-4 max-md:min-h-[180px] [&_.verovio-score-page]:inline-block [&_.verovio-score-page]:align-top [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-none [&_svg]:shrink-0" ref={containerRef} />
			{renderState === 'loading'
				? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#fff8e7] font-mono text-[0.75rem] font-bold text-[#2b2633]/72 uppercase">Engraving score…</div>
				: null}
			{renderState === 'error'
				? <div className="absolute inset-0 grid place-items-center bg-[#fff8e7] px-6 text-center font-mono text-[0.75rem] font-bold text-[#8d3c3c] uppercase">Verovio could not render this score.</div>
				: null}
		</div>
	)
}

function estimateMeasureCount(timemap: TimemapEntry[]): number {
	return timemap.filter(entry => entry.measureOn).length
}

/**
 * Produce an MEI string containing only the staves belonging to `focusedCategory`.
 * If nothing is focused — or no staves match — the original MEI is returned
 * unchanged so the toolkit renders the full arrangement.
 */
function filterMeiByCategory(
	mei: string,
	staffsByCategory: NonNullable<Song['scoreSource']>['staffsByCategory'],
	focusedCategory: InstrumentCategory | null,
): string {
	if (!focusedCategory) {
		return mei
	}
	const keep = staffsByCategory[focusedCategory]
	if (!keep || keep.length === 0) {
		return mei
	}
	const keepSet = new Set(keep)

	let doc: Document
	try {
		doc = new DOMParser().parseFromString(mei, 'application/xml')
	}
	catch {
		return mei
	}
	if (doc.getElementsByTagName('parsererror').length > 0) {
		return mei
	}

	const dropByN = (tagName: string) => {
		for (const element of Array.from(doc.getElementsByTagNameNS('*', tagName))) {
			const n = element.getAttribute('n')
			if (n && !keepSet.has(n)) {
				element.parentNode?.removeChild(element)
			}
		}
	}
	dropByN('staffDef')
	dropByN('staff')

	let cleaning = true
	while (cleaning) {
		cleaning = false
		for (const group of Array.from(doc.getElementsByTagNameNS('*', 'staffGrp'))) {
			if (group.getElementsByTagNameNS('*', 'staffDef').length === 0) {
				group.parentNode?.removeChild(group)
				cleaning = true
			}
		}
	}

	return new XMLSerializer().serializeToString(doc)
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

function buildMeasureEntries(timemap: TimemapEntry[]): MeasureEntry[] {
	const measures: MeasureEntry[] = []
	for (const entry of timemap) {
		if (entry.measureOn) {
			measures.push({
				measureId: entry.measureOn,
				tstamp: entry.tstamp,
			})
		}
	}
	return measures
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

function measureAtTime(measures: MeasureEntry[], timestamp: number): MeasureEntry {
	let match = measures[0]!
	for (const measure of measures) {
		if (measure.tstamp > timestamp) {
			break
		}
		match = measure
	}
	return match
}

function scrollHorizontallyTo(container: HTMLElement, target: Element | null) {
	if (!target) {
		return
	}

	const containerRect = container.getBoundingClientRect()
	const targetRect = target.getBoundingClientRect()
	const targetCenter = targetRect.left + targetRect.width / 2
	const containerCenter = containerRect.left + containerRect.width * 0.42

	container.scrollTo({
		behavior: 'smooth',
		left: Math.max(0, container.scrollLeft + targetCenter - containerCenter),
	})
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
