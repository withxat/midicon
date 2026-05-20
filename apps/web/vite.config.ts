import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('/tone/') || id.includes('@tonejs')) {
						return 'audio'
					}
					if (id.includes('/three/') || id.includes('@react-three')) {
						return 'scene'
					}
					return undefined
				},
			},
		},
	},
	plugins: [react()],
})
