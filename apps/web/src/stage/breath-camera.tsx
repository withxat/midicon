import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Vector3 } from 'three'

interface BreathCameraProps {
	/** Base camera position (looking at the origin). */
	basePosition?: [number, number, number]
	/** Where the camera looks at by default. */
	baseTarget?: [number, number, number]
}

const targetVec = new Vector3()
const lookRef = new Vector3()

/**
 * Camera "breathing": holds a static framing of the stage while drifting by a
 * few centimeters every couple of seconds so the scene feels alive without
 * shot rotations or focus chasing.
 */
export function BreathCamera({
	basePosition = [0, 3.2, 11.4],
	baseTarget = [0, 0.1, -0.6],
}: BreathCameraProps) {
	const elapsedRef = useRef(0)

	useFrame((state, dt) => {
		elapsedRef.current += dt
		const t = elapsedRef.current

		const swayX = Math.sin(t * 0.16) * 0.12
		const swayY = Math.sin(t * 0.22 + 1.5) * 0.06
		const swayZ = Math.sin(t * 0.11 + 0.7) * 0.18

		targetVec.set(
			basePosition[0] + swayX,
			basePosition[1] + swayY,
			basePosition[2] + swayZ,
		)
		const ease = 1 - Math.exp(-dt * 1.2)
		state.camera.position.lerp(targetVec, ease)

		lookRef.set(baseTarget[0] + swayX * 0.3, baseTarget[1], baseTarget[2])
		state.camera.lookAt(lookRef)
	})

	return null
}
