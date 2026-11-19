import { afterEach, describe, expect, it, vi } from "vitest";
import { createReconciler } from "./reconcile.js";
import {
  ROOM_POLICIES,
  createRoomState,
  enter,
  leave,
  knock,
  decide,
  closeRoom,
  transferHost,
  resize,
} from "./room-state.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const room = createRoomState("room", "host", ROOM_POLICIES.Stage);
  for (const id of ["host", "a", "b", "c", "d", "e", "f", "g"])
    enter(room, id, { isBot: false, displayName: id });
  const calls: string[] = [];
  const adapter = {
    status: vi.fn((value: string | null) => {
      calls.push(`status:${value}`);
      return Promise.resolve();
    }),
    limit: vi.fn((value: number) => {
      calls.push(`limit:${value}`);
      return Promise.resolve();
    }),
    admission: {
      closeAccess: vi.fn(() => {
        calls.push("close");
        return Promise.resolve();
      }),
      openAccess: vi.fn(() => {
        calls.push("open");
        return Promise.resolve();
      }),
      grant: vi.fn((id: string) => {
        calls.push(`grant:${id}`);
        return Promise.resolve();
      }),
      revoke: vi.fn((id: string) => {
        calls.push(`revoke:${id}`);
        return Promise.resolve();
      }),
    },
  };
  let time = 0;
  const reconcile = createReconciler(room, adapter, { now: () => time });
  function approve(id = "jacob") {
    const request = knock(room, id);
    decide(room, room.hostId!, room.generation, id, request, true, time);
  }
  return {
    room,
    adapter,
    calls,
    reconcile,
    approve,
    setTime: (value: number) => {
      time = value;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("convergent Discord effects (fake overflow adapter only)", () => {
  it("closes before granting/raising, coalesces five departures, and rearms on refill", async () => {
    const f = setup();
    f.approve();
    await f.reconcile.schedule();
    expect(f.calls.slice(0, 3)).toEqual(["close", "grant:jacob", "limit:9"]);
    f.calls.length = 0;
    const work = [];
    for (const id of ["a", "b", "c", "d", "e"]) {
      leave(f.room, id);
      work.push(f.reconcile.schedule());
    }
    await Promise.all(work);
    expect(f.calls).toEqual(["revoke:jacob", "limit:8", "open"]);
    expect(f.room.requests.has("jacob")).toBe(true);
    for (const id of ["a", "b", "c", "d", "e"])
      enter(f.room, id, { isBot: false, displayName: id });
    await f.reconcile.schedule();
    expect(f.calls.slice(-3)).toEqual(["close", "grant:jacob", "limit:9"]);
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it("adds headroom when privileged staff takes an armed slot", async () => {
    const f = setup();
    f.approve();
    await f.reconcile.schedule();
    enter(f.room, "staff", { isBot: false, displayName: "Staff" });
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().hardLimit).toBe(10);
    expect(f.room.normalCapacity).toBe(8);
    expect(f.room.requests.has("jacob")).toBe(true);
    leave(f.room, "staff");
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().hardLimit).toBe(10); // Stable controlled headroom.
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it("serializes two approvals and consumes only the entrant's admission", async () => {
    const f = setup();
    f.approve();
    f.approve("emily");
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().hardLimit).toBe(10);
    enter(f.room, "jacob", { isBot: false, displayName: "Jacob" });
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().grants.has("jacob")).toBe(false);
    expect(f.room.requests.has("emily")).toBe(true);
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it.each(["transfer", "entry", "deletion", "shutdown"])(
    "compensates stale grant completion after %s",
    async (action) => {
      const f = setup();
      f.approve();
      const gate = deferred();
      f.adapter.admission.grant.mockImplementationOnce(() => gate.promise);
      const work = f.reconcile.schedule();
      await vi.waitFor(() =>
        expect(f.adapter.admission.grant).toHaveBeenCalledOnce(),
      );
      if (action === "transfer")
        transferHost(f.room, "host", "a", f.room.generation);
      if (action === "entry") {
        enter(f.room, "jacob", { isBot: false, displayName: "Jacob" });
        leave(f.room, "host");
      }
      if (action === "deletion" || action === "shutdown")
        closeRoom(f.room, action === "deletion");
      gate.resolve();
      await work;
      expect(f.adapter.limit).not.toHaveBeenCalledWith(9);
      if (action !== "deletion")
        expect(f.adapter.admission.revoke).toHaveBeenCalledWith("jacob");
      expect(f.room.requests.size).toBe(0);
      closeRoom(f.room);
      await f.reconcile.stop();
    },
  );
  it("keeps failed revocation as an obligation and disables new overflow", async () => {
    const f = setup();
    f.approve();
    await f.reconcile.schedule();
    f.adapter.admission.revoke.mockRejectedValueOnce(new Error("network"));
    transferHost(f.room, "host", "a", f.room.generation);
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().grants.has("jacob")).toBe(true);
    expect(f.reconcile.inspect().degraded).toBe(true);
    expect(f.reconcile.inspect().hardLimit).toBe(8);
    expect(f.adapter.admission.openAccess).not.toHaveBeenCalled();
    f.approve("emily");
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().grants.size).toBe(0);
    expect(f.adapter.admission.grant).toHaveBeenCalledTimes(1);
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it("expires a window without needing another Gateway event", async () => {
    vi.useFakeTimers();
    const f = setup();
    f.approve();
    await f.reconcile.schedule();
    f.setTime(45_000);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(f.room.requests.size).toBe(0);
    expect(f.reconcile.inspect().grants.size).toBe(0);
    expect(f.calls.slice(-3)).toEqual(["revoke:jacob", "limit:8", "open"]);
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it("reconciles a newer Host after an old status write completes", async () => {
    const f = setup();
    const gate = deferred();
    f.adapter.status.mockImplementationOnce(() => gate.promise);
    const work = f.reconcile.schedule();
    await vi.waitFor(() => expect(f.adapter.status).toHaveBeenCalledOnce());
    leave(f.room, "host");
    gate.resolve();
    await work;
    expect(f.adapter.status).toHaveBeenLastCalledWith("👑 a");
    closeRoom(f.room);
    await f.reconcile.stop();
  });
  it("does not undo Host state on status failure", async () => {
    const f = setup();
    f.adapter.status.mockRejectedValueOnce(new Error("permission"));
    await f.reconcile.schedule();
    expect(f.room.hostId).toBe("host");
    expect(f.room.generation).toBe(1);
    await f.reconcile.schedule();
    expect(f.adapter.status).toHaveBeenCalledTimes(2);
    closeRoom(f.room);
    await f.reconcile.stop();
  });
});

it("does not reopen after an ambiguous elevated-limit write and failed rollback", async () => {
  const f = setup();
  f.approve();
  f.adapter.limit
    .mockRejectedValueOnce(new Error("response lost"))
    .mockRejectedValueOnce(new Error("offline"));
  await f.reconcile.schedule();
  expect(f.reconcile.inspect().hardLimit).toBeNull();
  expect(f.reconcile.inspect().grants.has("jacob")).toBe(true);
  expect(f.adapter.admission.openAccess).not.toHaveBeenCalled();
  await f.reconcile.schedule();
  expect(f.calls.slice(-3)).toEqual(["revoke:jacob", "limit:8", "open"]);
  closeRoom(f.room);
  await f.reconcile.stop();
});

it("rechecks latest normal capacity after an awaited limit write", async () => {
  const f = setup();
  const gate = deferred();
  resize(f.room, "host", f.room.generation, 4);
  f.adapter.limit.mockImplementationOnce(() => gate.promise);
  const work = f.reconcile.schedule();
  await vi.waitFor(() => expect(f.adapter.limit).toHaveBeenCalledWith(4));
  resize(f.room, "host", f.room.generation, 12);
  gate.resolve();
  await work;
  expect(f.adapter.limit).toHaveBeenLastCalledWith(12);
  expect(f.reconcile.inspect().hardLimit).toBe(12);
  closeRoom(f.room);
  await f.reconcile.stop();
});

it("does not arm beyond overflow bounds when staff consume all headroom", async () => {
  const f = setup();
  f.approve();
  await f.reconcile.schedule();
  for (let i = 0; i < 4; i++)
    enter(f.room, `staff${i}`, { isBot: false, displayName: "Staff" });
  await f.reconcile.schedule();
  expect(f.room.members.size).toBe(12);
  expect(f.room.normalCapacity).toBe(8);
  expect(f.room.requests.has("jacob")).toBe(true);
  expect(f.reconcile.inspect().grants.size).toBe(0);
  expect(f.adapter.limit.mock.calls.every(([limit]) => limit <= 12)).toBe(true);
  closeRoom(f.room);
  await f.reconcile.stop();
});

it("does not repeatedly retry an expired window while disconnected", async () => {
  vi.useFakeTimers();
  const f = setup();
  f.approve();
  let ready = true;
  const reconciler = createReconciler(f.room, f.adapter, {
    now: () => Date.now(),
    ready: () => ready,
  });
  // Use the same epoch as the injected clock for the window.
  const request = f.room.requests.get("jacob")!;
  if (request.state === "approved") request.expiresAt = Date.now() + 45_000;
  await reconciler.schedule();
  ready = false;
  await vi.advanceTimersByTimeAsync(45_000);
  expect(f.room.requests.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  ready = true;
  await reconciler.schedule();
  expect(reconciler.inspect().grants.size).toBe(0);
  closeRoom(f.room);
  await reconciler.stop();
});

it.each(["jacob", "emily"])(
  "handles %s taking a newly opened normal slot",
  async (entrant) => {
    const f = setup();
    f.approve();
    await f.reconcile.schedule();
    leave(f.room, "a");
    await f.reconcile.schedule();
    expect(f.reconcile.inspect().gateClosed).toBe(false);
    expect(f.reconcile.inspect().hardLimit).toBe(8);
    enter(f.room, entrant, { isBot: false, displayName: entrant });
    await f.reconcile.schedule();
    expect(f.room.members.size).toBe(8);
    expect(f.room.requests.has("jacob")).toBe(entrant === "emily");
    expect(f.reconcile.inspect().grants.has("jacob")).toBe(entrant === "emily");
    closeRoom(f.room);
    await f.reconcile.stop();
  },
);

it.each(["close", "limit"])(
  "compensates a Host change during the %s write",
  async (step) => {
    const f = setup();
    f.approve();
    const gate = deferred();
    if (step === "close")
      f.adapter.admission.closeAccess.mockImplementationOnce(
        () => gate.promise,
      );
    else f.adapter.limit.mockImplementationOnce(() => gate.promise);
    const work = f.reconcile.schedule();
    await vi.waitFor(() =>
      expect(
        step === "close" ? f.adapter.admission.closeAccess : f.adapter.limit,
      ).toHaveBeenCalledOnce(),
    );
    leave(f.room, "host");
    gate.resolve();
    await work;
    expect(f.reconcile.inspect().grants.size).toBe(0);
    expect(f.reconcile.inspect().hardLimit).toBe(8);
    expect(f.reconcile.inspect().gateClosed).toBe(false);
    if (step === "close")
      expect(f.adapter.admission.grant).not.toHaveBeenCalled();
    else
      expect(f.calls.indexOf("limit:8")).toBeLessThan(f.calls.indexOf("open"));
    closeRoom(f.room);
    await f.reconcile.stop();
  },
);

it("never grants or raises the limit if closing ordinary access fails", async () => {
  const f = setup();
  f.approve();
  f.adapter.admission.closeAccess.mockRejectedValueOnce(
    new Error("unsupported layout"),
  );
  await f.reconcile.schedule();
  expect(f.adapter.admission.grant).not.toHaveBeenCalled();
  expect(f.adapter.limit).toHaveBeenCalledWith(8);
  expect(f.adapter.limit).not.toHaveBeenCalledWith(9);
  expect(f.reconcile.inspect().degraded).toBe(true);
  closeRoom(f.room);
  await f.reconcile.stop();
});
