import { useMediaQuery } from 'foxact/use-media-query'

const MOBILE_BREAKPOINT = 768

export function useIsMobile({ breakpoint = MOBILE_BREAKPOINT } = {}) {
	const isMobile = useMediaQuery(`(max-width: ${breakpoint - 1}px)`, false)

	return isMobile
}
