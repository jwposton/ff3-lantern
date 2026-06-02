import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const backendUrl = process.env.VITE_BACKEND_URL ?? "http://localhost:8000"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": backendUrl,
      "/api": backendUrl,
    },
  },
})
