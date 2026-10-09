import { defineProperty, Dict, isNullable } from './std'
import { Context } from './context'
import { getTraceable, symbols, withProps } from './utils'
import { Fiber, FiberState } from './fiber'

declare module './context' {
  interface Context {
    get<K extends string & keyof this>(name: K, strict?: boolean): undefined | this[K]
    get(name: string, strict?: boolean): any
    set<K extends string & keyof this>(name: K, value: undefined | this[K]): void
    set(name: string, value: any): void
    provide<K extends string & keyof this>(name: K, value: undefined | this[K]): () => void
    provide(name: string, value?: any): () => void
    accessor(name: string, options: Omit<Property.Accessor, 'type'>): void
    mixin<K extends string & keyof this>(name: K, mixins: (keyof this & keyof this[K])[] | Dict<string>): void
    mixin<T extends {}>(source: T, mixins: (keyof this & keyof T)[] | Dict<string>): void
  }
}

function enhanceError(error: Error) {
  const lines = error.stack!.split('\n')
  lines.splice(0, 2, `Error: ${error.message}`)
  error.stack = lines.join('\n')
  return error
}

const RESERVED_WORDS = ['prototype', 'then']

// - is a symbol
// - is a reserved word (prototype, then)
// - is a number string (0, 1, 2, ...)
// - starts with `_`
function isSpecialProperty(prop: string | symbol): prop is symbol {
  return typeof prop === 'symbol'
    || RESERVED_WORDS.includes(prop)
    || isNumberString(prop)
    || prop.startsWith('_')
}

// Property reads go through here constantly; skip `parseInt` unless the name can be a number.
function isNumberString(prop: string) {
  const first = prop.charCodeAt(0)
  const couldBeNumber = (first >= 48 && first <= 57) || first === 45
  return couldBeNumber && parseInt(prop).toString() === prop
}

// The common case of reading an injected service: no `internal/get` hooks, and the service is
// provided by the fiber chain. Returns `missing` instead of throwing so the caller can fall back
// to the full path, which builds the error (and its stack trace) only when it is needed.
const missing = Symbol('missing')

function fastGet(target: Context, prop: string, ctx: Context): any {
  if (target.events._hooks['internal/get']?.length) return missing
  const def = target.reflect.props[prop]
  if (def?.type === 'accessor') return missing
  if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)
  let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber
  const key = target[symbols.isolate][prop]
  while (true) {
    const impl = fiber.store?.[prop]
    if (impl) return getTraceable(ctx, impl.value)
    if (prop in fiber.inject) return missing
    if (!fiber.runtime) return missing
    if (fiber.parent[symbols.isolate][prop] !== key) return missing
    fiber = fiber.parent.fiber
  }
}

export type Property = Property.Service | Property.Accessor

export namespace Property {
  export interface Service {
    type: 'service'
  }

  export interface Accessor {
    type: 'accessor'
    get: (this: Context, receiver: any, error: Error) => any
    set?: (this: Context, value: any, receiver: any, error: Error) => boolean
  }
}

export interface Impl {
  name: string
  fiber: Fiber
  value?: any
  check?: () => boolean
}

export class ReflectService {
  static handler: ProxyHandler<Context> = {
    get: (target, prop, ctx: Context) => {
      if (isSpecialProperty(prop)) {
        return Reflect.get(target, prop, ctx)
      }
      if (Reflect.has(target, prop)) {
        return getTraceable(ctx, Reflect.get(target, prop, ctx))
      }

      const fast = fastGet(target, prop, ctx)
      if (fast !== missing) return fast

      const error = new Error(`cannot get property "${prop}" without inject`)

      try {
        const def = target.reflect.props[prop]
        if (def?.type === 'accessor') {
          return def.get.call(ctx, ctx[symbols.receiver], error)
        }

        if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false)
        return ctx.events.waterfall('internal/get', ctx, prop, error, () => {
          const key = target[symbols.isolate][prop]
          let fiber = (ctx[symbols.shadow] as Context ?? ctx).fiber
          while (true) {
            const impl = fiber.store?.[prop]
            if (impl) return getTraceable(ctx, impl.value)
            if (prop in fiber.inject) {
              error.message = `cannot get required service "${prop}" in inactive context`
              throw error
            }
            if (!fiber.runtime) throw error
            if (fiber.parent[symbols.isolate][prop] !== key) throw error
            fiber = fiber.parent.fiber
          }
        })
      } catch (e: any) {
        throw e === error ? enhanceError(e) : e
      }
    },

    set: (target, prop, value, ctx: Context) => {
      if (isSpecialProperty(prop)) {
        return Reflect.set(target, prop, value, ctx)
      }

      const error = new Error(`cannot set property "${prop}" without provide`)
      const def = target.reflect.props[prop]
      if (!def) {
        if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx)
        throw enhanceError(error)
      }

      try {
        if (def.type === 'accessor') {
          if (!def.set) return false
          return def.set.call(ctx, value, ctx[symbols.receiver], error)
        }

        return ctx.events.waterfall('internal/set', ctx, prop, value, error, () => {
          return ctx.reflect.set(prop, value, error)
        })
      } catch (e: any) {
        throw e === error ? enhanceError(e) : e
      }
    },

    has: (target, prop) => {
      if (isSpecialProperty(prop)) {
        return Reflect.has(target, prop)
      }
      if (Reflect.has(target, prop)) return true
      return !!target.reflect.props[prop]
    },
  }

  public store: Dict<Impl, symbol> = Object.create(null)
  public props: Dict<Property> = Object.create(null)

  // How many declared property names start with `<prefix>.`, for every prefix. Lets the traceable
  // `get` trap skip the `${associate}.${prop}` lookup for services that have no associate props.
  private associatePrefixes = new Map<string, number>()

  constructor(public ctx: Context) {
    defineProperty(this, symbols.tracker, {
      property: 'ctx',
      noShadow: true,
    })

    this.mixin('reflect', ['get', 'set', 'provide', 'accessor', 'mixin'])
    this.mixin('fiber', ['runtime', 'effect'])
    this.mixin('registry', ['inject', 'plugin'])
    this.mixin('events', ['on', 'once', 'parallel', 'emit', 'serial', 'bail', 'waterfall'])
  }

  hasAssociateProps(associate: string) {
    return this.associatePrefixes.has(associate)
  }

  private declareProperty(name: string, property: Property) {
    if (!this.props[name]) this.countAssociatePrefixes(name, 1)
    this.props[name] = property
  }

  private undeclareProperty(name: string) {
    if (this.props[name]) this.countAssociatePrefixes(name, -1)
    delete this.props[name]
  }

  private countAssociatePrefixes(name: string, delta: number) {
    let dotIndex = name.indexOf('.')
    while (dotIndex !== -1) {
      const prefix = name.slice(0, dotIndex)
      const count = (this.associatePrefixes.get(prefix) ?? 0) + delta
      if (count > 0) {
        this.associatePrefixes.set(prefix, count)
      } else {
        this.associatePrefixes.delete(prefix)
      }
      dotIndex = name.indexOf('.', dotIndex + 1)
    }
  }

  get(name: string, strict = true) {
    return getTraceable(this.ctx, this._getImpl(name, strict)?.value)
  }

  _getImpl(name: string, strict = true) {
    const key = this.ctx[symbols.isolate][name]
    const impl = key && this.store[key]
    if (!impl) return
    if (strict && impl.fiber.state !== FiberState.ACTIVE) return
    return impl
  }

  set(name: string, value: any, error?: Error) {
    const key = this.ctx[symbols.isolate][name]
    const impl = this.store[key]
    if (!impl) {
      throw new Error(`cannot set property "${name}" without provide`)
    }
    if (impl.fiber !== this.ctx.fiber) {
      throw new Error(`cannot set property "${name}" in multiple fibers`)
    }
    impl.value = value
    return true
  }

  provide(name: string, value?: any, check?: () => boolean) {
    return this.ctx.fiber.effect(() => {
      if (this.props[name] && this.props[name].type !== 'service') {
        throw new Error(`property "${name}" is already declared as ${this.props[name].type}`)
      }
      this.declareProperty(name, { type: 'service' })

      this.ctx.root[symbols.isolate][name] ??= Symbol(name)
      const key = this.ctx[symbols.isolate][name]
      const impl: Impl = { name, value, fiber: this.ctx.fiber, check }
      if (this.store[key]) {
        throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`)
      }
      this.store[key] = impl
      this.ctx.fiber.store![name] = impl
      if (this.ctx.fiber.state === FiberState.ACTIVE) {
        this.notify([name])
      }
      return async () => {
        delete this.store[key]
        const fibers = this.notify([name])
        await Promise.allSettled(fibers.map(fiber => fiber.await()))
        // ensure self access before dependencies cleanup
        delete this.ctx.fiber.store![name]
      }
    }, `ctx.provide(${JSON.stringify(name)})`)
  }

  notify(names: string[], filter = (ctx: Context, name: string) => ctx[symbols.isolate][name] === this.ctx[symbols.isolate][name]) {
    const fibers: Fiber[] = []
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        let hasUpdate = false
        for (const name of names) {
          if (!(name in fiber.inject)) continue
          if (!filter(fiber.ctx, name)) continue
          hasUpdate = true
          fiber._checkImpl(name)
        }
        if (!hasUpdate) continue
        fiber._refresh()
        fibers.push(fiber)
      }
    }
    for (const name of names) {
      const self: Context = Object.create(this.ctx)
      self[symbols.filter] = (target: Context) => filter(target, name)
      this.ctx.events.emit(self, 'internal/service', name, this._getImpl(name, false)?.value)
    }
    return fibers
  }

  accessor(name: string, options: Omit<Property.Accessor, 'type'>) {
    return this.ctx.fiber.effect(() => {
      if (name in this.props) {
        throw new Error(`property "${name}" is already declared as ${this.props[name].type}`)
      }
      this.declareProperty(name, { type: 'accessor', ...options })
      return () => this.undeclareProperty(name)
    }, `ctx.accessor(${JSON.stringify(name)})`)
  }

  mixin(source: any, mixins: string[] | Dict<string>) {
    const self = this
    return this.ctx.fiber.effect(function* () {
      const entries = Array.isArray(mixins) ? mixins.map(key => [key, key]) : Object.entries(mixins)
      const getTarget = (ctx: Context, error: Error) => {
        // TODO enhance error message
        return ctx[source]
      }
      for (const [key, value] of entries) {
        yield self.accessor(value, {
          get(receiver, error) {
            const service = getTarget(this, error)
            if (isNullable(service)) return service
            const mixin = receiver ? withProps(receiver, service) : service
            const value = Reflect.get(service, key, mixin)
            if (typeof value !== 'function') return value
            return value.bind(mixin ?? service)
          },
          set(value, receiver, error) {
            const service = getTarget(this, error)
            const mixin = receiver ? withProps(receiver, service) : service
            return Reflect.set(service, key, value, mixin)
          },
        })
      }
    }, `ctx.mixin(${JSON.stringify(source)})`)
  }

  trace<T>(value: T) {
    return getTraceable(this.ctx, value)
  }

  bind<T extends Function>(callback: T) {
    return new Proxy(callback, {
      apply: (target, thisArg, args) => {
        return Reflect.apply(target, this.trace(thisArg), args.map(arg => this.trace(arg)))
      },
      construct: (target, args, newTarget) => {
        return Reflect.construct(target, args.map(arg => this.trace(arg)), newTarget)
      },
    })
  }
}
