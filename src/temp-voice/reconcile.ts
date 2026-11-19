import {
  desiredAdmission,
  expire,
  hostStatus,
  type RoomState,
} from "./room-state.js";

/** No production implementation yet. closeAccess must verify ALL ordinary Connect paths
 * are closed, preserve bot access, and reject unsupported permission layouts.
 * grant/revoke must preserve unrelated bits and restore the original Connect value.
 */
export type AdmissionAdapter = {
  closeAccess(): Promise<void>;
  openAccess(): Promise<void>;
  grant(memberId: string): Promise<void>;
  revoke(memberId: string): Promise<void>;
};
export type RoomAdapter = {
  status(value: string | null): Promise<void>;
  limit(value: number): Promise<void>;
  admission?: AdmissionAdapter;
};

export function createReconciler(
  room: RoomState,
  adapter: RoomAdapter,
  options: {
    now?: () => number;
    ready?: () => boolean;
    onError?: () => void;
  } = {},
) {
  const now = options.now ?? Date.now;
  let confirmedStatus: string | null | undefined = null;
  let hardLimit: number | null = room.normalCapacity;
  let gateClosed = false;
  let degraded = false;
  // Includes uncertain writes: register BEFORE REST, remove only after confirmed revocation.
  const grants = new Map<string, number>();
  let dirty = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function armExpiry() {
    clearTimeout(timer);
    if (room.closed) return;
    const deadlines = [...room.requests.values()].flatMap((r) =>
      r.state === "approved" ? [r.expiresAt] : [],
    );
    if (deadlines.length) {
      timer = setTimeout(
        () => {
          void schedule();
        },
        Math.max(1, Math.min(...deadlines) - now()),
      );
      timer.unref();
    }
  }

  async function setLimit(target: number) {
    hardLimit = null; // An ambiguous failure must never be mistaken for a confirmed safe limit.
    await adapter.limit(target);
    hardLimit = target;
  }

  async function converge() {
    expire(room, now());
    while (dirty && !room.deleted && (options.ready?.() ?? true)) {
      dirty = false;
      expire(room, now());
      // Every iteration computes from current state; never continue an old multi-write plan.
      const desired = desiredAdmission(room, now());
      const admission = adapter.admission;
      let failed = false;
      try {
        if (admission) {
          const stale = [...grants].find(
            ([id, generation]) =>
              degraded ||
              generation !== room.generation ||
              !desired.grants.includes(id),
          );
          if (stale) {
            await admission.revoke(stale[0]);
            grants.delete(stale[0]);
            dirty = true;
            continue;
          }
          if (degraded || !desired.closed) {
            if (hardLimit !== room.normalCapacity) {
              await setLimit(room.normalCapacity);
              dirty = true;
              continue;
            }
            if (gateClosed) {
              await admission.openAccess();
              gateClosed = false;
              dirty = true;
              continue;
            }
          } else {
            if (!gateClosed) {
              gateClosed = true; // On failure retain the obligation to restore access.
              await admission.closeAccess();
              dirty = true;
              continue;
            }
            const missing = desired.grants.find((id) => !grants.has(id));
            if (missing) {
              grants.set(missing, room.generation);
              await admission.grant(missing);
              dirty = true;
              continue;
            }
            // Retain safe headroom during a window rather than shrink/re-expand on each departure.
            const target = Math.min(
              room.normalCapacity + room.policy.maxOverflow,
              Math.max(hardLimit ?? 0, desired.hardLimit),
            );
            if (hardLimit !== target) {
              await setLimit(target);
              dirty = true;
              continue;
            }
          }
        } else if (hardLimit !== room.normalCapacity) {
          await setLimit(room.normalCapacity);
          dirty = true;
          continue;
        }
      } catch {
        if (room.deleted) break;
        failed = true;
        degraded = true;
        options.onError?.();
        // A failed write may have succeeded remotely. Never open the gate or activate
        // more grants after ambiguity. Attempt a safe limit, retain cleanup obligations.
        try {
          await setLimit(room.normalCapacity);
        } catch {
          options.onError?.();
        }
        // Retry cleanup on a later observation/expiry/shutdown, not a tight error loop.
        dirty = false;
      }
      const status = hostStatus(room);
      if (status !== confirmedStatus) {
        try {
          confirmedStatus = undefined;
          await adapter.status(status);
          confirmedStatus = status;
          dirty = true;
        } catch {
          options.onError?.();
        }
      }
      if (failed) {
        dirty = false;
        break;
      }
    }
    if (room.deleted) grants.clear();
    armExpiry();
  }
  function schedule(): Promise<void> {
    dirty = true;
    running ??= Promise.resolve()
      .then(converge)
      .finally(() => {
        running = undefined;
      });
    return running;
  }
  return {
    schedule,
    inspect: () => ({
      hardLimit,
      gateClosed,
      degraded,
      grants: new Map(grants),
    }),
    async stop() {
      clearTimeout(timer);
      await schedule();
      clearTimeout(timer);
    },
  };
}
