import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/llama': {
          target: env.LLAMA_SERVER_URL || 'http://127.0.0.1:8080',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/llama/, ''),
        },
      },
    },
  }
})
