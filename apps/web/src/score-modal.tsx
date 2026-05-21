import type { ReactNode } from 'react'

import { useEffect } from 'react'
import { X } from 'ui/icons'

interface ScoreModalProps {
	children: ReactNode
	onClose: () => void
	subtitle?: string
	title: string
}

/**
 * Full-screen overlay used to host the Verovio score on demand. Closes on ESC
 * or backdrop click; the inner panel handles its own scrolling so the engraved
 * score can be much taller than the viewport.
 */
export function ScoreModal({ children, onClose, subtitle, title }: ScoreModalProps) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose()
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			document.body.style.overflow = previousOverflow
		}
	}, [onClose])

	return (
		<div
			aria-label={title}
			aria-modal="true"
			className="fixed inset-0 z-50 grid place-items-center bg-[#0d0c12]/82 px-4 py-6 backdrop-blur-[10px]"
			onClick={onClose}
			role="dialog"
		>
			<div
				className="grid max-h-[92vh] w-full max-w-[1240px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#fff8e7]/14 bg-[#18161f] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
				onClick={event => event.stopPropagation()}
			>
				<header className="flex items-start justify-between gap-4 border-b border-[#fff8e7]/12 px-6 py-4">
					<div className="min-w-0">
						<p className="mb-1 font-mono text-[0.7rem] font-bold tracking-[0.08em] text-[#ffcf70] uppercase">Engraved score</p>
						<h2 className="m-0 truncate text-[clamp(1.25rem,2vw,1.7rem)] leading-tight">{title}</h2>
						{subtitle
							? <p className="mt-1 font-mono text-[0.72rem] leading-snug text-[#fff8e7]/60">{subtitle}</p>
							: null}
					</div>
					<button
						aria-label="Close score"
						className="grid size-[40px] shrink-0 place-items-center rounded-lg border border-[#fff8e7]/16 bg-[#fff8e7]/6 text-[#fff8e7] transition duration-150 ease-out hover:bg-[#fff8e7]/12 active:scale-[0.96]"
						onClick={onClose}
						type="button"
					>
						<X size={18} />
					</button>
				</header>
				<div className="min-h-0 overflow-auto bg-[#16141d] p-5">
					{children}
				</div>
			</div>
		</div>
	)
}
