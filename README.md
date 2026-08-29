# @neoworks/extension-system

Plugin kernel with revertible effects and reactive dependency resolution. Zero runtime dependencies.

A plugin declares what it needs and hands the runtime an inverse for everything it does. The
runtime activates it only while its dependencies are live, and unwinds its effects — in LIFO
order — the moment they aren't.

```ts
import { Context } from '@neoworks/extension-system'

const editor = (ctx: Context) => {
  ctx.effect(() => {
    const proc = spawn('tsserver')
    return () => proc.kill()          // the inverse; the runtime holds it
  }, 'tsserver')

  ctx.on('buffer/open', (buf) => ctx.lsp.didOpen(buf))   // unbound automatically
}
editor.inject = ['lsp', 'buffers']

const root = new Context()
await root.plugin(editor)   // stays PENDING until `lsp` and `buffers` exist
```

## What you get

| API | Purpose |
| --- | --- |
| `ctx.effect(fn, label?)` | Register a side effect with its inverse. Accepts a disposer, a promise, or a (async) generator yielding disposers for stepwise rollback. |
| `ctx.plugin(plugin, config?)` | Mount a plugin. Returns a thenable `Fiber`. |
| `ctx.inject(deps, fn)` | Run `fn` only while `deps` are all available. |
| `ctx.provide(name, value)` | Publish a service under a key. |
| `ctx.isolate(name)` | Give a subtree its own implementation behind the same key. |
| `ctx.intercept(name, config)` | Per-consumer configuration of a service. |
| `ctx.accessor` / `ctx.mixin` | Expose computed or flattened properties on every context. |
| `ctx.on` / `emit` / `parallel` / `serial` / `bail` / `waterfall` | Five event dispatch modes. |
| `ctx.logger` | Levelled logging with pluggable exporters (default sink is an in-memory ring buffer). |

Fiber lifecycle: `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`, plus `FAILED`.
Reactivation is epoch-based — a fiber only reloads when the *identity* of a resolved dependency
changes, not on every unrelated context change.

Plugin config is validated through [Standard Schema](https://standardschema.dev), so zod,
valibot and arktype all work as-is. Async validation is not supported.

## Agent skill

This repo ships a Claude Code skill teaching plugin authoring against this API
(`skills/extension-system/SKILL.md`). Claude Code does **not** scan `node_modules`, so installing
the npm package alone does not make the skill available. Pick one:

**Install as a plugin** (recommended — the repo is also a marketplace):

```sh
/plugin marketplace add neoworks/extension-system
/plugin install neoworks@neoworks
```

Then invoke with `/neoworks:extension-system`, or let Claude load it automatically when it sees
this package imported.

**Point at it locally**, without installing:

```sh
claude --plugin-dir ./node_modules/@neoworks/extension-system
```

**Vendor it into a consuming project**, if you'd rather it be checked in there:

```sh
mkdir -p .claude/skills
cp -r node_modules/@neoworks/extension-system/skills/extension-system .claude/skills/
```

The skill directory is included in the npm tarball, so all three work from a plain install.

## Development

```sh
bun install
bun run test        # vitest
bun run typecheck
bun run lint        # oxlint
bun run build       # bun build → lib/index.js, tsc → lib/*.d.ts
```

Two toolchain notes worth knowing before you touch the config:

- **Tests run on vitest, not `bun test`.** The fiber tests drive the inertia lock with
  `vi.advanceTimersByTimeAsync`. Bun's fake timers don't intercept `setTimeout` and have no
  async advancement, so those tests cannot run under `bun test` today. Vitest is a dev
  dependency only — nothing ships.
- **Vitest transforms via SWC, not esbuild.** The `@Inject()` decorator uses TC39 standard
  decorators, which esbuild passes through untransformed; Node then fails to parse them.
  See `vitest.config.ts`.

The lint config disables a handful of rules that fight this codebase on purpose:
`no-underscore-dangle` (the `_` prefix is semantic — `reflect.ts` routes those properties past
the proxy), `unicorn/no-thenable` (`Fiber` is deliberately thenable so `await ctx.plugin()`
works), `no-this-alias` (constructors return proxies and callables), and `no-await-in-loop`
(the inertia lock must be sequential).

## Credit

Derived from [Cordis](https://github.com/cordiverse/cordis) by Shigma (MIT), at `v4.0.0-rc.8`,
commit `b3df558`. The design is described in *A Programming Paradigm for Spatiotemporal
Composability* ([arXiv:2608.25512](https://arxiv.org/abs/2608.25512)).

Changes from upstream: flattened from a monorepo package to a standalone package; `cosmokit`
and `@standard-schema/spec` vendored into `src/std.ts` and `src/schema.ts` to remove all runtime
dependencies; yarn/yakumo/eslint replaced with bun/oxlint; the loader CLI (`bin.js`) dropped,
since it depended on `@cordisjs/plugin-loader`; `FiberState` and `LoggerLevel` changed from
`const enum` to plain `enum` so they are usable under `isolatedModules`.
