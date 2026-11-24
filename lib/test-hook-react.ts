/**
 * Minimal hook runtime used by the hook tests.
 *
 * The unit tests run under `node --test` with no DOM and no React test
 * renderer. This file implements just enough of useState / useEffect /
 * useCallback to execute a real hook function, run its effects and observe the
 * state it returns. It is mapped to the `react` specifier by the test-only
 * resolver in test-engipay-hook-hooks.mjs.
 */
type Deps = readonly unknown[] | undefined
type Cleanup = () => void
type Effect = () => void | Cleanup

interface StateEntry {
  value: unknown
  deps?: Deps
  callback?: (...args: never[]) => unknown
}

interface EffectEntry {
  deps?: Deps
  cleanup?: Cleanup
}

interface PendingEffect {
  index: number
  effect: Effect
  deps?: Deps
}

interface HookInstance {
  hook: (...args: never[]) => unknown
  args: unknown[]
  entries: StateEntry[]
  effects: Map<number, EffectEntry>
  pending: PendingEffect[]
  stateIndex: number
  effectIndex: number
  result: unknown
  mounted: boolean
}

let currentInstance: HookInstance | undefined

function instance(): HookInstance {
  if (!currentInstance) {
    throw new Error("Hooks can only be called from renderHook()")
  }
  return currentInstance
}

function sameDeps(previous: Deps, next: Deps): boolean {
  if (!previous || !next || previous.length !== next.length) return false
  return previous.every((value, index) => Object.is(value, next[index]))
}

function flushEffects(inst: HookInstance): void {
  const pending = inst.pending
  inst.pending = []

  for (const { index, effect, deps } of pending) {
    const previous = inst.effects.get(index)
    if (previous && sameDeps(previous.deps, deps)) {
      inst.effects.set(index, { deps, cleanup: previous.cleanup })
      continue
    }

    previous?.cleanup?.()
    // Record the effect before running it: the callback may set state, which
    // re-renders synchronously and must not start this effect a second time.
    const entry: EffectEntry = { deps }
    inst.effects.set(index, entry)

    const cleanup = effect()
    entry.cleanup = typeof cleanup === "function" ? (cleanup as Cleanup) : undefined
  }
}

function render(inst: HookInstance): void {
  const previousInstance = currentInstance
  currentInstance = inst
  inst.stateIndex = 0
  inst.effectIndex = 0
  inst.pending = []

  try {
    inst.result = (inst.hook as (...args: unknown[]) => unknown)(...inst.args)
    flushEffects(inst)
  } finally {
    currentInstance = previousInstance
  }
}

export function useState<S>(
  initial: S | (() => S)
): [S, (next: S | ((previous: S) => S)) => void] {
  const inst = instance()
  const index = inst.stateIndex++
  let entry = inst.entries[index]

  if (!entry) {
    const value =
      typeof initial === "function" ? (initial as () => S)() : initial
    entry = { value }
    inst.entries[index] = entry
  }

  const state = entry
  const setState = (next: S | ((previous: S) => S)): void => {
    if (!inst.mounted) return
    const value =
      typeof next === "function" ? (next as (previous: S) => S)(state.value as S) : next
    if (Object.is(value, state.value)) return
    state.value = value
    render(inst)
  }

  return [state.value as S, setState]
}

export function useEffect(effect: Effect, deps?: Deps): void {
  const inst = instance()
  inst.pending.push({ index: inst.effectIndex++, effect, deps })
}

export function useCallback<F extends (...args: never[]) => unknown>(
  callback: F,
  deps?: Deps
): F {
  const inst = instance()
  const index = inst.stateIndex++
  const previous = inst.entries[index]

  if (previous?.callback && sameDeps(previous.deps, deps)) {
    return previous.callback as F
  }

  inst.entries[index] = {
    value: callback,
    deps,
    callback: callback as (...args: never[]) => unknown,
  }
  return callback
}

export interface HookHandle<T> {
  /** The value most recently returned by the hook. */
  readonly current: T
  /** Run every registered effect cleanup, as a real unmount would. */
  unmount(): void
  /** Render again with new hook arguments, if any. */
  rerender(...args: unknown[]): void
}

export function renderHook<T>(
  hook: (...args: never[]) => T,
  args: unknown[] = []
): HookHandle<T> {
  const inst: HookInstance = {
    hook: hook as (...args: never[]) => unknown,
    args,
    entries: [],
    effects: new Map(),
    pending: [],
    stateIndex: 0,
    effectIndex: 0,
    result: undefined,
    mounted: true,
  }
  render(inst)

  return {
    get current(): T {
      return inst.result as T
    },
    unmount(): void {
      if (!inst.mounted) return
      inst.mounted = false
      for (const entry of inst.effects.values()) entry.cleanup?.()
      inst.effects.clear()
    },
    rerender(...next: unknown[]): void {
      if (next.length > 0) inst.args = next
      render(inst)
    },
  }
}
