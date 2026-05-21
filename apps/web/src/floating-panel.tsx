import type { ReactNode } from 'react'

import { useEffect } from 'react'
import { X } from 'ui/icons'

interface FloatingPanelProps {
	align?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
	children: ReactNode
	onClose: () => void
	subtitle?: string
	title: string
}

const alignClass: Record<NonNullable<FloatingPanelProps['align']>, string> = {
	'bottom-left': 'left-4 bottom-24 max-md:right-4 max-md:left-4 max-md:bottom-28',
	'bottom-right': 'right-4 bottom-24 max-md:right-4 max-md:left-4 max-md:bottom-28',
	'top-left': 'left-4 top-28 max-md:right-4 max-md:left-4 max-md:top-32',
	'top-right': 'right-4 top-20 max-md:left-4 max-md:right-4',
}

/**
 * Anchored card overlay used by the performer picker and the piano roll
 * drawer. Doesn't lock the rest of the UI (so playback controls stay live)
 * but still respects ESC to close and adapts to small screens.
 */
export function FloatingPanel({ align = 'bottom-right', children, onClose, subtitle, title }: FloatingPanelProps) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	return (
		<aside
			aria-label={title}
			className={`pointer-events-auto fixed z-30 grid w-[420px] max-w-[calc(100vw-2rem)] gap-3 rounded-lg border border-[#fff8e7]/14 bg-[#18161f]/95 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-[14px] ${alignClass[align]}`}
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="font-mono text-[0.66rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">{title}</p>
					{subtitle
						? <p className="mt-0.5 truncate font-mono text-[0.7rem] text-[#fff8e7]/60">{subtitle}</p>
						: null}
				</div>
				<button
					aria-label="Close panel"
					className="grid size-[28px] shrink-0 place-items-center rounded-md border border-[#fff8e7]/14 bg-[#fff8e7]/8 text-[#fff8e7] transition duration-150 ease-out hover:bg-[#fff8e7]/14 active:scale-[0.96]"
					onClick={onClose}
					type="button"
				>
					<X size={14} />
				</button>
			</header>
			<div className="min-w-0">{children}</div>
		</aside>
	)
}
