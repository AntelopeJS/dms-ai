import { HOST_COMMAND_NAVIGATE_TYPE, LOG_PREFIX } from './constants'

interface RouterLike {
	push: (path: string) => unknown
}

/**
 * The slice of the host's `useDmsDevReload()` composable this module needs:
 * resolve `true` once the committed site layout serves `path`, `false` on
 * timeout.
 */
export interface DevReloadWaiter {
	awaitRoute: (path: string) => Promise<boolean>
}

export interface HostCommandContext {
	router: RouterLike
	devReload: DevReloadWaiter
}

export interface HostCommandNavigateMessage {
	type: typeof HOST_COMMAND_NAVIGATE_TYPE
	path: string
}

export type HostCommandMessage = HostCommandNavigateMessage

export type HostCommandDispatcher = (raw: unknown) => void

/**
 * Commands run one at a time on `tail`. `nextPath` holds the newest navigation
 * target still waiting for a slot, so a burst collapses into a single trip to
 * the latest path instead of racing and landing on the oldest one.
 */
interface DispatcherState {
	ctx: HostCommandContext
	tail: Promise<void>
	nextPath: string | null
}

type HostCommandHandler = (
	msg: HostCommandMessage,
	state: DispatcherState,
) => void

function enqueue(state: DispatcherState, job: () => Promise<void>): void {
	state.tail = state.tail.then(job).catch((err: unknown) => {
		console.error(`${LOG_PREFIX} host command failed`, err)
	})
}

// The agent asks to navigate right after writing the page, while the host is
// still re-registering modules: the route can be momentarily unserved and
// pushing now would flash a 404. Wait for the committed layout to serve it.
// Navigate whatever the wait reports — a lapsed deadline or a broken waiter
// must not strand the user on the previous page; a genuinely missing page then
// 404s as it did before.
async function awaitRouteThenPush(
	path: string,
	ctx: HostCommandContext,
): Promise<void> {
	try {
		await ctx.devReload.awaitRoute(path)
	} catch (err: unknown) {
		console.error(`${LOG_PREFIX} dev reload wait failed for ${path}`, err)
	}
	void ctx.router.push(path)
}

async function runNavigate(state: DispatcherState): Promise<void> {
	const path = state.nextPath
	// A newer navigate already claimed this slot's target: this one is superseded
	// and must not drag the user back to the older path.
	if (path === null) return
	state.nextPath = null
	await awaitRouteThenPush(path, state.ctx)
}

function handleNavigate(
	msg: HostCommandMessage,
	state: DispatcherState,
): void {
	if (msg.type !== HOST_COMMAND_NAVIGATE_TYPE) return
	state.nextPath = msg.path
	enqueue(state, () => runNavigate(state))
}

const COMMAND_HANDLERS: Record<string, HostCommandHandler> = {
	[HOST_COMMAND_NAVIGATE_TYPE]: handleNavigate,
}

function isHostCommand(value: unknown): value is HostCommandMessage {
	if (value === null || typeof value !== 'object') return false
	const candidate = value as { type?: unknown }
	return typeof candidate.type === 'string'
}

function parseRaw(raw: unknown): HostCommandMessage | null {
	if (typeof raw !== 'string') return null
	try {
		const parsed = JSON.parse(raw) as unknown
		if (!isHostCommand(parsed)) return null
		return parsed
	} catch {
		return null
	}
}

export function createHostCommandDispatcher(
	ctx: HostCommandContext,
): HostCommandDispatcher {
	const state: DispatcherState = {
		ctx,
		tail: Promise.resolve(),
		nextPath: null,
	}
	return (raw: unknown): void => {
		const msg = parseRaw(raw)
		if (msg === null) return
		const handler = COMMAND_HANDLERS[msg.type]
		if (handler === undefined) {
			console.warn(`${LOG_PREFIX} unknown host command type=${msg.type}`)
			return
		}
		handler(msg, state)
	}
}
