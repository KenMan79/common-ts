import { equal } from '../util'

export type Awaitable<T> = T | Promise<T>
export type Mapper<T, U> = (t: T) => Awaitable<U>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NamedEventuals<T> = { [k: string]: Eventual<any> } & { [K in keyof T]: T[K] }

export type Join<T> = Eventual<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { [key in keyof T]: T[key] extends Eventual<infer U> ? U : any }
>

export type Subscriber<T> = (value: T) => void

export interface Eventual<T> {
  readonly valueReady: boolean
  value(): Promise<T>

  subscribe(subscriber: Subscriber<T>): void

  map<U>(f: Mapper<T, U>): Eventual<U>
  pipe(f: (t: T) => void): void
  throttle(interval: number): Eventual<T>
}

export interface WritableEventual<T> extends Eventual<T> {
  push(value: T): void
}

export class EventualValue<T> implements WritableEventual<T> {
  inner: T | undefined

  promise: Promise<T> | undefined
  resolvePromise?: (value: T) => void

  subscribers: Subscriber<T>[] = []

  constructor(initial?: T) {
    this.inner = initial
    this.promise = new Promise<T>(resolve => {
      if (this.inner !== undefined) {
        resolve(this.inner)
      } else {
        this.resolvePromise = resolve
      }
    })
  }

  get valueReady(): boolean {
    return this.inner !== undefined
  }

  value(): Promise<T> {
    if (this.promise) {
      return this.promise
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return Promise.resolve(this.inner!)
    }
  }

  subscribe(subscriber: Subscriber<T>): void {
    this.subscribers.push(subscriber)
    if (this.inner !== undefined) {
      subscriber(this.inner)
    }
  }

  push(value: T): void {
    if (!equal(this.inner, value)) {
      this.inner = value
      this.resolvePromise?.call(this, value)
      this.promise = undefined
      this.resolvePromise = undefined
      this.subscribers.forEach(subscriber => subscriber(value))
    }
  }

  map<U>(f: Mapper<T, U>): Eventual<U> {
    return map(this, f)
  }

  pipe(f: (t: T) => void): void {
    return pipe(this, f)
  }

  throttle(interval: number): Eventual<T> {
    return throttle(this, interval)
  }
}

export function mutable<T>(initial?: T): WritableEventual<T> {
  return new EventualValue(initial)
}

export function map<T, U>(
  source: Eventual<T>,
  mapper: (t: T) => Awaitable<U>,
): Eventual<U> {
  const output: WritableEventual<U> = mutable()

  let previousT: T | undefined
  let latestT: T | undefined
  let mapPromise: Promise<void> | undefined

  source.subscribe(t => {
    latestT = t
    if (mapPromise === undefined) {
      mapPromise = (async () => {
        while (!equal(latestT, previousT)) {
          previousT = latestT
          output.push(await mapper(latestT))
        }
        mapPromise = undefined
      })()
    }
  })

  return output
}

export function pipe<T>(source: Eventual<T>, fn: (t: T) => Awaitable<void>): void {
  map(source, fn)
}

export function throttle<T>(source: Eventual<T>, interval: number): Eventual<T> {
  const output: WritableEventual<T> = mutable()

  let latestT: T | undefined
  let timeout: NodeJS.Timeout | undefined
  let lastPushed = Date.now()

  source.subscribe(t => {
    if (!output.valueReady) {
      latestT = t
      output.push(t)
      lastPushed = Date.now()
    } else if (!equal(t, latestT)) {
      latestT = t

      if (!timeout) {
        timeout = setTimeout(() => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          output.push(latestT!)
          lastPushed = Date.now()
          timeout = undefined
        }, Math.max(0, Math.min(interval, Date.now() - lastPushed)))
      }
    }
  })

  return output
}

export function poll<T>(
  fn: (previous: T | undefined) => Awaitable<T>,
  interval: number,
): Eventual<T> {
  const output: WritableEventual<T> = mutable()

  let value: T | undefined

  const run = async () => {
    const newValue = await fn(value)
    if (!equal(newValue, value)) {
      value = newValue
      output.push(value)
    }
  }

  setTimeout(async () => {
    await run()
    setInterval(run, interval)
  }, 0)

  return output
}