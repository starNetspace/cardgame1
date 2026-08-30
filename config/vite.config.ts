import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/frontend',
  publicDir: '../../public',
  plugins: [react()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
})