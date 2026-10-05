import { Context, Service } from '../src'
import { describe, expect, it } from 'vitest'

class Store extends Service {
  items = [1, 2, 3]
  constructor(ctx: Context) {
    super(ctx, 'store')
  }

  first() {
    return this.items[0]
  }

  owner() {
    return this.ctx
  }
}

describe('traceable wrappers', () => {
  it('reuses the service wrapper and its methods across reads', async () => {
    const root = new Context()
    await root.plugin(Store)
    await root.plugin({
      name: 'consumer',
      inject: ['store'],
      apply(ctx: any) {
        expect(ctx.store).toBe(ctx.store)
        expect(ctx.store.first).toBe(ctx.store.first)
        expect(ctx.store.first()).toBe(1)
      },
    } as any)
  })

  it('keeps the caller as the method receiver context per plugin', async () => {
    const root = new Context()
    await root.plugin(Store)
    const owners: unknown[] = []
    for (const name of ['first', 'second']) {
      await root.plugin({
        name,
        inject: ['store'],
        apply(ctx: any) {
          owners.push(ctx.store.owner().fiber)
          expect(ctx.store.owner().fiber).toBe(ctx.fiber)
        },
      } as any)
    }
    expect(owners[0]).not.toBe(owners[1])
  })

  it('still refuses services that were not injected', async () => {
    const root = new Context()
    await root.plugin(Store)
    let thrown: unknown
    await root.plugin({
      name: 'sneaky',
      apply(ctx: any) {
        try {
          void ctx.store
        } catch (error) {
          thrown = error
        }
      },
    } as any)
    expect(String(thrown)).toMatch(/store/)
  })
})
