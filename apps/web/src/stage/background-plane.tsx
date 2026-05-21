import type { Mesh, PerspectiveCamera, Texture } from 'three'

import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LinearFilter, SRGBColorSpace, TextureLoader, Vector3 } from 'three'

interface BackgroundPlaneProps {
	/** World-space distance in front of the camera. */
	distance?: number
	src?: string
}

const forwardVec = new Vector3()

/**
 * Textured plane that rides along with the camera so the artwork always covers
 * the viewport — no matter how the camera breathes or the viewport resizes.
 * It is still a real 3D quad (so future shaders / overlays in scene space can
 * interact with it), but its size is computed from the camera frustum so the
 * background never reveals the void behind it.
 */
export function BackgroundPlane({ distance = 22, src = '/background.png' }: BackgroundPlaneProps) {
	const meshRef = useRef<Mesh>(null)
	const camera = useThree(state => state.camera) as PerspectiveCamera
	const size = useThree(state => state.size)
	const [texture, setTexture] = useState<null | Texture>(null)

	useEffect(() => {
		let cancelled = false
		const loader = new TextureLoader()
		loader.load(
			src,
			(loaded) => {
				if (cancelled) {
					loaded.dispose()
					return
				}
				loaded.colorSpace = SRGBColorSpace
				loaded.minFilter = LinearFilter
				loaded.magFilter = LinearFilter
				setTexture(loaded)
			},
			undefined,
			() => {
				// Asset is optional; render the stage without it.
			},
		)
		return () => {
			cancelled = true
		}
	}, [src])

	useEffect(() => () => {
		texture?.dispose()
	}, [texture])

	const dimensions = useMemo(() => {
		if (!texture) {
			return null
		}
		const image = texture.image as undefined | { height: number, width: number }
		const imageAspect = image && image.width > 0 && image.height > 0 ? image.width / image.height : 16 / 9
		const fov = (camera.fov * Math.PI) / 180
		const viewportHeight = 2 * Math.tan(fov / 2) * distance
		const viewportWidth = viewportHeight * (size.width / size.height)

		// Cover behavior: scale the plane so that the smaller axis of the image
		// still fills the viewport; the larger axis overflows and gets cropped
		// by the viewport edges (like CSS `background-size: cover`).
		const planeHeight = Math.max(viewportHeight, viewportWidth / imageAspect)
		const planeWidth = planeHeight * imageAspect

		return { height: planeHeight, width: planeWidth }
	}, [camera, distance, size.height, size.width, texture])

	useFrame(() => {
		const mesh = meshRef.current
		if (!mesh) {
			return
		}
		forwardVec.set(0, 0, -1).applyQuaternion(camera.quaternion)
		mesh.position.copy(camera.position).addScaledVector(forwardVec, distance)
		mesh.quaternion.copy(camera.quaternion)
	})

	if (!texture || !dimensions) {
		return null
	}

	return (
		<mesh ref={meshRef} renderOrder={-10}>
			<planeGeometry args={[dimensions.width, dimensions.height]} />
			<meshBasicMaterial depthWrite={false} map={texture} toneMapped={false} />
		</mesh>
	)
}
