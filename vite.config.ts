import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/ninfer': {
          target:
            env.NINFER_SERVER_URL ||
            env.LLAMA_SERVER_URL ||
            'http://127.0.0.1:18080',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/ninfer/, ''),
        },
      },
    },
  }
})
