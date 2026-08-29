// Minimal standard-library helpers, vendored to keep this package dependency-free.
// Behaviour is identical to the `cosmokit` implementations these replaced.

export type Dict<T = any, K extends string | symbol = string> = { [key in K]: T }

export type Awaitable<T> = [T] extends [Promise<unknown>] ? T : T | Promise<T>

export type Promisify<T> = Promise<T extends Promise<infer S> ? S : T>

export function isNullable(value: any): value is null | undefined | void {
  return value === null || value === undefined
}

export function defineProperty<T, K extends keyof T>(object: T, key: K, value: T[K]): T
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any): T
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any) {
  return Object.defineProperty(object, key, { writable: true, value, enumerable: false })
}

const enum State {
  DELIM,
  UPPER,
  LOWER,
}

/** Convert `camelCase`, `snake_case` and `kebab-case` alike to `kebab-case`. */
export function hyphenate(source: string) {
  const delimiters = [45, 95] // '-' and '_'
  const delimiter = 45 // '-'
  const output: number[] = []
  let state = State.DELIM
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    if (code >= 65 && code <= 90) {
      if (state === State.UPPER) {
        const next = source.charCodeAt(i + 1)
        if (next >= 97 && next <= 122) {
          output.push(delimiter)
        }
        output.push(code + 32)
      } else {
        if (state !== State.DELIM) {
          output.push(delimiter)
        }
        output.push(code + 32)
      }
      state = State.UPPER
    } else if (code >= 97 && code <= 122) {
      output.push(code)
      state = State.LOWER
    } else if (delimiters.includes(code)) {
      if (state !== State.DELIM) {
        output.push(delimiter)
      }
      state = State.DELIM
    } else {
      output.push(code)
    }
  }
  return String.fromCharCode(...output)
}
