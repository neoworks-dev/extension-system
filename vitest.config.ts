import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    // esbuild (vite's default TS transform) passes TC39 standard decorators
    // through untransformed, which Node then fails to parse. SWC lowers them.
    swc.vite({
      jsc: {
        target: 'es2024',
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorVersion: '2022-03' },
      },
    }),
  ],
  test: {
    pool: 'forks',
    include: ['tests/**/*.spec.ts'],
  },
})
