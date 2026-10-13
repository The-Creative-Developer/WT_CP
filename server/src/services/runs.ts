import { setTimeout as sleep } from 'node:timers/promises';
import {
  hasRoomRole,
  MAX_CODE_BYTES,
  utf8Length,
  type CreateRunInput,
  type ListRunsQuery,
  type Language,
  type RunDto,
  type RunEvent,
  type RunRequest,
  type RunResult,
  type RunStatus,
  type RunStream,
  type ServerToClientEvents,
} from '@devverse/shared';
import { Types } from 'mongoose';
import PQueue from 'p-queue';
import { File } from '../models/file';
import { Run, type RunAttrs } from '../models/run';
import { User } from '../models/user';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';
import type { AuthUser } from './auth';
import { resolveRoomAccess, usernamesById } from './rooms';

type RunEventName = 'run:started' | 'run:output' | 'run:finished';

/** A run event addressed to everyone in a room. The socket layer subscribes and forwards these. */
export type RunBroadcast = {
  [E in RunEventName]: {
    roomSlug: string;
    event: E;
    payload: Parameters<ServerToClientEvents[E]>[0];
  };
}[RunEventName];

export interface RunServiceOptions {
  runnerUrl: string;
  runnerToken: string;
  /** The text a room currently sees in a file, if anyone has it open. Falls back to the saved copy. */
  liveText?: (fileId: string) => Promise<string | undefined>;
  /** Runs executed at once. Matches the runner's own limit, so it rarely has to answer "busy". */
  concurrency?: number;
  /** Runs allowed to wait in the queue before new ones are turned away with 503. */
  maxQueued?: number;
  /** Per user, per minute. Enforced by the route's rate limiter. */
  maxRunsPerMinute?: number;
  /** Upper bound for one run, including waiting for a busy runner. The runner kills programs after 5 s. */
  runTimeoutMs?: number;
  /** How long run output is collected before being sent to the room as one event. */
  outputFlushMs?: number;
}

/** What only exists while a run is queued or running. */
interface ActiveRun {
  id: string;
  roomSlug: string;
  userId: string;
  status: Extract<RunStatus, 'queued' | 'running'>;
  stdout: string;
  stderr: string;
  abort: AbortController;
}

class RunFailure extends Error {}

const BUSY_RETRY_LIMIT = 10;

export type RunService = ReturnType<typeof createRunService>;

export function createRunService({
  runnerUrl,
  runnerToken,
  liveText,
  concurrency = 2,
  maxQueued = 20,
  maxRunsPerMinute = 10,
  runTimeoutMs = 60_000,
  outputFlushMs = 50,
}: RunServiceOptions) {
  // [CONCEPT: Job Queue] POST /runs answers immediately; the work waits here and at most `concurrency` runs use the
  // runner at once. In memory, so it relies on a single API instance (ADR 006); BullMQ + Redis would lift that.
  const queue = new PQueue({ concurrency });
  const active = new Map<string, ActiveRun>();
  // One run at a time per person: a second click while the first is still going is almost always a mistake.
  const activeByUser = new Set<string>();
  const listeners = new Set<(broadcast: RunBroadcast) => void>();

  function publish(broadcast: RunBroadcast) {
    for (const listener of listeners) listener(broadcast);
  }

  async function start(user: AuthUser, input: CreateRunInput): Promise<RunDto> {
    const access = await resolveRoomAccess(user.id, { slug: input.roomSlug });
    if (!hasRoomRole(access.role, 'editor')) {
      throw HttpError.forbidden('Viewers can watch runs but not start them');
    }
    const file = await File.findOne({ _id: input.fileId, projectId: access.projectId })
      .select('content')
      .lean();
    if (!file) throw HttpError.notFound('File not found');

    if (activeByUser.has(user.id)) {
      throw HttpError.tooManyRequests('Your last run is still going. Wait for it to finish.', 2);
    }
    // [CONCEPT: Load Shedding] Past this point a run would wait so long that its output is no longer useful;
    // saying "busy, try again" now is kinder than a spinner that never ends.
    if (queue.size >= maxQueued) {
      throw HttpError.serviceUnavailable('The code runner is busy. Try again in a few seconds.', 5);
    }
    // Reserved before the next await, so two clicks arriving together can't both get through.
    activeByUser.add(user.id);

    try {
      const code = (await liveText?.(input.fileId)) ?? file.content;
      if (utf8Length(code) > MAX_CODE_BYTES) {
        throw new HttpError(422, `This file is too large to run (${MAX_CODE_BYTES / 1024} KB max)`);
      }
      const run = await Run.create({
        userId: user.id,
        roomId: access.roomId,
        fileId: input.fileId,
        language: access.language,
      });
      const state: ActiveRun = {
        id: run.id as string,
        roomSlug: access.slug,
        userId: user.id,
        status: 'queued',
        stdout: '',
        stderr: '',
        abort: new AbortController(),
      };
      active.set(state.id, state);
      const request: RunRequest = { language: access.language, code, stdin: input.stdin ?? '' };
      void queue.add(() => execute(state, request, user.username));
      return toDto(run.toObject(), access.slug, user, state);
    } catch (err) {
      activeByUser.delete(user.id);
      throw err;
    }
  }

  async function execute(state: ActiveRun, request: RunRequest, username: string) {
    const output = createOutputBatcher(outputFlushMs, (stream, chunk) =>
      publish({
        roomSlug: state.roomSlug,
        event: 'run:output',
        payload: { runId: state.id, stream, chunk },
      }),
    );
    let result: RunResult | null = null;
    let error: string | null = null;

    try {
      const signal = AbortSignal.any([state.abort.signal, AbortSignal.timeout(runTimeoutMs)]);
      const body = await callRunner(request, signal);

      state.status = 'running';
      publish({
        roomSlug: state.roomSlug,
        event: 'run:started',
        payload: { runId: state.id, by: username, language: request.language },
      });

      for await (const event of readNdjson(body)) {
        if (event.type === 'output') {
          state[event.stream] += event.chunk;
          output.push(event.stream, event.chunk);
        } else if (event.type === 'finished') {
          const { type: _type, ...rest } = event;
          result = rest;
        } else if (event.type === 'failed') {
          error = event.message;
        }
      }
      if (!result && !error) error = 'The code runner stopped unexpectedly';
    } catch (err) {
      error = describeFailure(err, state.abort.signal);
      if (!(err instanceof RunFailure)) logger.error({ err, runId: state.id }, 'Run failed');
    } finally {
      output.flush();
    }

    const outcome = {
      status: (result ? 'finished' : 'failed') as RunStatus,
      stdout: state.stdout,
      stderr: state.stderr,
      verdict: result?.verdict ?? null,
      exitCode: result?.exitCode ?? null,
      durationMs: result?.durationMs ?? null,
      truncated: result?.truncated ?? false,
      error,
    };
    try {
      await Run.updateOne({ _id: state.id }, { $set: outcome });
    } catch (err) {
      logger.error({ err, runId: state.id }, 'Failed to save run');
    }
    active.delete(state.id);
    activeByUser.delete(state.userId);

    // [CONCEPT: Security Logging] Sandbox kills (timeouts, memory, output floods) are worth noticing in the logs.
    logger.info(
      { runId: state.id, userId: state.userId, verdict: outcome.verdict, error },
      'Run finished',
    );
    publish({
      roomSlug: state.roomSlug,
      event: 'run:finished',
      payload: {
        runId: state.id,
        verdict: outcome.verdict,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        truncated: outcome.truncated,
        error,
      },
    });
  }

  async function callRunner(request: RunRequest, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(new URL('/runs', runnerUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${runnerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      // [CONCEPT: Backpressure] The runner says when it's full; wait as long as it asks, then try again.
      if (res.status === 503 && attempt < BUSY_RETRY_LIMIT) {
        await res.body?.cancel();
        const seconds = Number(res.headers.get('retry-after') ?? NaN);
        const waitS = Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 10) : 1;
        await sleep(waitS * 1000, undefined, { signal });
        continue;
      }
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        logger.error({ status: res.status, detail }, 'Runner rejected a run');
        throw new RunFailure('The code runner could not start this run');
      }
      return res.body;
    }
  }

  async function get(user: AuthUser, runId: string): Promise<RunDto> {
    // [CONCEPT: Hiding Resource Existence] Non-members get the same 404 as a wrong id, so run ids can't be probed.
    const notFound = HttpError.notFound('Run not found');
    if (!Types.ObjectId.isValid(runId)) throw notFound;
    const run = await Run.findById(runId).lean();
    if (!run) throw notFound;
    const access = await resolveRoomAccess(user.id, { id: run.roomId }).catch((err: unknown) => {
      throw err instanceof HttpError && err.status === 403 ? notFound : err;
    });
    const author = await User.findById(run.userId).select('username').lean();
    return toDto(
      run,
      access.slug,
      { id: run.userId.toString(), username: author?.username ?? 'deleted user' },
      active.get(runId),
    );
  }

  /** A room's runs, newest first. Lets a page that was just opened or reconnected show what it missed. */
  async function list(user: AuthUser, { room, limit }: ListRunsQuery): Promise<RunDto[]> {
    const access = await resolveRoomAccess(user.id, { slug: room });
    const runs = await Run.find({ roomId: access.roomId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    // One query for every author, rather than one per run.
    const names = await usernamesById(runs.map((run) => run.userId));
    return runs.map((run) => {
      const id = run.userId.toString();
      return toDto(
        run,
        access.slug,
        { id, username: names.get(id) ?? 'deleted user' },
        active.get(run._id.toString()),
      );
    });
  }

  return {
    maxRunsPerMinute,
    start,
    get,
    list,

    /** Receives every run event; returns an unsubscribe function. */
    subscribe(listener: (broadcast: RunBroadcast) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Stops every queued and running run, and waits until each one is saved as failed. */
    async close() {
      for (const state of active.values()) state.abort.abort();
      await queue.onIdle();
    },
  };
}

/** Runs that were queued or running when the API last stopped can never finish; say so instead of "queued" forever. */
export async function markInterruptedRuns() {
  const { modifiedCount } = await Run.updateMany(
    { status: { $in: ['queued', 'running'] } },
    { $set: { status: 'failed', error: 'Interrupted because the server restarted' } },
  );
  if (modifiedCount) logger.warn({ count: modifiedCount }, 'Marked interrupted runs as failed');
}

function describeFailure(err: unknown, shutdown: AbortSignal): string {
  if (err instanceof RunFailure) return err.message;
  if (shutdown.aborted) return 'Interrupted because the server is restarting';
  if (err instanceof DOMException && err.name === 'TimeoutError') return 'The run took too long';
  return 'Could not reach the code runner';
}

function toDto(
  run: Pick<
    RunAttrs,
    | 'fileId'
    | 'language'
    | 'status'
    | 'stdout'
    | 'stderr'
    | 'verdict'
    | 'exitCode'
    | 'durationMs'
    | 'truncated'
    | 'error'
    | 'createdAt'
  > & { _id: Types.ObjectId },
  roomSlug: string,
  by: { id: string; username: string },
  live?: ActiveRun,
): RunDto {
  return {
    id: run._id.toString(),
    roomSlug,
    fileId: run.fileId.toString(),
    language: run.language as Language,
    status: live?.status ?? run.status,
    by: { id: by.id, username: by.username },
    stdout: live?.stdout ?? run.stdout,
    stderr: live?.stderr ?? run.stderr,
    verdict: run.verdict,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    truncated: run.truncated,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  };
}

/**
 * [CONCEPT: Batching] A program printing in a tight loop produces hundreds of tiny chunks. Sending each one as its
 * own socket event would flood every client in the room, so consecutive chunks from the same stream are merged and
 * sent at most every `intervalMs`. Switching stream sends what's pending first, which keeps the order intact.
 */
function createOutputBatcher(intervalMs: number, send: (stream: RunStream, chunk: string) => void) {
  let pending: { stream: RunStream; chunk: string } | null = null;
  let timer: NodeJS.Timeout | null = null;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending) send(pending.stream, pending.chunk);
    pending = null;
  }

  return {
    flush,
    push(stream: RunStream, chunk: string) {
      if (pending && pending.stream !== stream) flush();
      pending = { stream, chunk: (pending?.chunk ?? '') + chunk };
      timer ??= setTimeout(flush, intervalMs);
    },
  };
}

/**
 * [CONCEPT: Stream Parsing] Network chunks don't line up with messages: one chunk may hold half a line or three.
 * Text is buffered until a newline completes each JSON object.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<RunEvent> {
  // stream: true keeps a multi-byte character that is split across two chunks in one piece.
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const bytes of body) {
    buffered += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim()) yield JSON.parse(line) as RunEvent;
    }
  }
  buffered += decoder.decode();
  if (buffered.trim()) yield JSON.parse(buffered) as RunEvent;
}
