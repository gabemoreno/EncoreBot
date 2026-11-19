import { describe, expect, it } from "vitest";
import {
  ROOM_POLICIES,
  createRoomState,
  enter,
  leave,
  transferHost,
  knock,
  decide,
  cancel,
  expire,
  closeRoom,
  resize,
  desiredAdmission,
  resync,
} from "./room-state.js";

const human = { isBot: false, displayName: "Human" };
function setup() {
  const room = createRoomState("room", "host", ROOM_POLICIES.Stage);
  enter(room, "host", human);
  return room;
}
function approve(room: ReturnType<typeof setup>, id = "jacob", now = 0) {
  const request = knock(room, id);
  decide(room, room.hostId!, room.generation, id, request, true, now);
}

describe("Host membership and authority", () => {
  it("requires confirmed creator presence and excludes bots", () => {
    const room = createRoomState("room", "host", ROOM_POLICIES.Stage);
    expect(room.hostId).toBeNull();
    enter(room, "bot", { ...human, isBot: true });
    expect(room.hostId).toBeNull();
    enter(room, "host", human);
    expect(room.hostId).toBe("host");
    leave(room, "host");
    expect(room.hostId).toBeNull();
    expect(room.members.size).toBe(1);
  });
  it("uses observed order, removes old positions, and never restores a returning Host", () => {
    const room = setup();
    enter(room, "a", human);
    enter(room, "bot", { ...human, isBot: true });
    enter(room, "b", human);
    enter(room, "c", human);
    enter(room, "a", human); // Duplicate observation must not reorder.
    leave(room, "a");
    enter(room, "a", human);
    leave(room, "host");
    expect(room.hostId).toBe("b");
    enter(room, "host", human);
    expect(room.hostId).toBe("b");
    leave(room, "b");
    leave(room, "c");
    expect(room.hostId).toBe("a");
  });
  it("transfers only to current humans, changes generation, and rejects stale returning Hosts", () => {
    const room = setup();
    enter(room, "b", human);
    enter(room, "bot", { ...human, isBot: true });
    const generation = room.generation;
    expect(() => transferHost(room, "host", "bot", generation)).toThrow();
    expect(() => transferHost(room, "host", "absent", generation)).toThrow();
    transferHost(room, "host", "host", generation);
    expect(room.generation).toBe(generation);
    transferHost(room, "host", "b", generation);
    expect(room.generation).toBe(generation + 1);
    transferHost(room, "b", "host", room.generation);
    expect(() => resize(room, "host", generation, 4)).toThrow();
  });
  it("invalidates pending and approved requests on succession and keeps admitted people", () => {
    const room = setup();
    enter(room, "next", human);
    knock(room, "pending");
    approve(room);
    approve(room, "inside");
    enter(room, "inside", human);
    leave(room, "host");
    expect(room.requests.size).toBe(0);
    expect(room.members.has("inside")).toBe(true);
    expect(room.hostId).toBe("next");
  });
});

describe("admission windows and capacity", () => {
  it("lets Emily take a normal vacancy without consuming Jacob's approval", () => {
    const room = setup();
    approve(room);
    enter(room, "emily", human);
    expect(room.requests.get("jacob")?.state).toBe("approved");
    enter(room, "jacob", human);
    expect(room.requests.has("jacob")).toBe(false);
  });
  it("expires unused approval and rejects stale request IDs and non-Host decisions", () => {
    const room = setup();
    const id = knock(room, "jacob");
    expect(knock(room, "jacob")).toBe(id);
    expect(() =>
      decide(room, "other", room.generation, "jacob", id, true, 10),
    ).toThrow();
    cancel(room, "jacob", id);
    const next = knock(room, "jacob");
    cancel(room, "jacob", id);
    expect(() =>
      decide(room, "host", room.generation, "jacob", id, true, 10),
    ).toThrow();
    decide(room, "host", room.generation, "jacob", next, true, 10);
    expire(room, 45_009);
    expect(room.requests.size).toBe(1);
    expire(room, 45_010);
    expect(room.requests.size).toBe(0);
    const declined = knock(room, "jacob");
    decide(room, "host", room.generation, "jacob", declined, false, 0);
    expect(room.requests.size).toBe(0);
  });
  it("counts privileged users and bots without altering policy or other approvals", () => {
    const room = setup();
    approve(room);
    enter(room, "staff-below", human);
    for (let i = 0; i < 6; i++)
      enter(room, String(i), { ...human, isBot: true });
    expect(desiredAdmission(room, 0).hardLimit).toBe(9);
    enter(room, "staff-above", human);
    expect(room.members.size).toBe(9);
    expect(room.normalCapacity).toBe(8);
    expect(desiredAdmission(room, 0).hardLimit).toBe(10);
    expect(room.requests.has("jacob")).toBe(true);
    resize(room, "host", room.generation, 4);
    expect(room.members.size).toBe(9);
    expect(desiredAdmission(room, 0).grants).toEqual([]);
    expect(room.requests.has("jacob")).toBe(true);
    expect(() => resize(room, "host", room.generation, 7)).toThrow();
  });
  it("tombstones deleted rooms and invalidates windows", () => {
    const room = setup();
    approve(room);
    closeRoom(room, true);
    enter(room, "late", human);
    expect(room.members.has("late")).toBe(false);
    expect(room.requests.size).toBe(0);
    expect(room.deleted).toBe(true);
    expect(() => knock(room, "late")).toThrow();
  });
});

it("invalidates approvals on resync while preserving known surviving join order", () => {
  const room = setup();
  enter(room, "a", human);
  enter(room, "b", human);
  approve(room);
  const oldGeneration = room.generation;
  resync(room, [
    { id: "new", ...human },
    { id: "b", ...human },
    { id: "a", ...human },
  ]);
  expect(room.hostId).toBe("a");
  expect(room.generation).toBeGreaterThan(oldGeneration);
  expect(room.requests.size).toBe(0);
  expect(room.members.get("new")!.sequence).toBeGreaterThan(
    room.members.get("b")!.sequence,
  );
});
