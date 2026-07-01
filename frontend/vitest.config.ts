import { readFileSync } from "node:fs"
import path from "path"
import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

const pkg = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"), "utf-8"),
) as { version: string }

export default mergeConfig(viteConfig, {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
})
