// Run with: bun bench/serviceAccess.bench.ts
import { Context, Service } from '../src'

class B extends Service {
  constructor(ctx: Context) {
    super(ctx, 'b')
  }

  get(x: number) {
    return x + 1
  }
}

class A extends Service {
  static inject = ['b']
  state = { y: 2 }
  someField = 42

  constructor(ctx: Context) {
    super(ctx, 'a')
  }

  method(x: number) {
    return (this.ctx as any).b.get(x) + this.state.y
  }
}

const iterations = 1_000_000

function measure(label: string, run: () => number) {
  run()
  const start = performance.now()
  const checksum = run()
  const elapsed = performance.now() - start
  const nanosecondsPerCall = (elapsed * 1e6) / iterations
  console.log(`${label.padEnd(28)} ${elapsed.toFixed(1)} ms  ${nanosecondsPerCall.toFixed(0)} ns/op  (${checksum})`)
}

async function main() {
  const root = new Context()
  await root.plugin(B)
  await root.plugin(A)

  await root.plugin({
    name: 'bench-consumer',
    inject: ['a'],
    apply(ctx: any) {
      measure('ctx.a.method(x)', () => {
        let sum = 0
        for (let i = 0; i < iterations; i++) sum += ctx.a.method(i)
        return sum
      })
      measure('ctx.a.someField', () => {
        let sum = 0
        for (let i = 0; i < iterations; i++) sum += ctx.a.someField
        return sum
      })
    },
  } as any)

}

await main()
