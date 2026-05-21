import type { Texture } from 'three'

import { useEffect, useState } from 'react'
import { LinearFilter, SRGBColorSpace, TextureLoader } from 'three'

import { backgroundWorldHeight, backgroundWorldWidth } from './orchestra-layout'

interface TheaterBackgroundProps {
	/** Texture source. Defaults to the theater stage image. */
	src?: string
	/** World-space z position; should sit behind every performer. */
	z?: number
}

/**
 * Theater backdrop rendered as a single textured plane. The plane has a
 * fixed world size; the camera zoom is what gets adjusted on resize so
 * that the plane covers the viewport. Performer coordinates therefore keep
 * their exact relationship to the backdrop on every screen.
 */
export function TheaterBackground({ src = '/stage/background.png', z = -10 }: TheaterBackgroundProps) {
	const [texture, setTexture] = useState<null | Texture>(null)

	useEffect(() => {
		let cancelled = false
		const loader = new TextureLoader()
		loader.load(src, (loaded) => {
			if (cancelled) {
				loaded.dispose()
				return
			}
			loaded.colorSpace = SRGBColorSpace
			loaded.minFilter = LinearFilter
			loaded.magFilter = LinearFilter
			setTexture(loaded)
		})
		return () => {
			cancelled = true
		}
	}, [src])

	useEffect(() => () => {
		texture?.dispose()
	}, [texture])

	if (!texture) {
		return null
	}

	return (
		<mesh position={[0, 0, z]} renderOrder={-1000}>
			<planeGeometry args={[backgroundWorldWidth, backgroundWorldHeight]} />
			<meshBasicMaterial depthWrite={false} map={texture} toneMapped={false} transparent={false} />
		</mesh>
	)
}
