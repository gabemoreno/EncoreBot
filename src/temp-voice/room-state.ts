/** Product policy: provisional values, kept together until defaults are finalized. */
export type CapacityPolicy = {
  readonly defaultNormal: number;
  readonly presets: readonly number[];
  readonly maxOverflow: number;
  readonly admissionWindowMs: number;
};
export const ROOM_POLICIES = {
  Backstage: {
    defaultNormal: 8,
    presets: [4, 8, 12],
    maxOverflow: 4,
    admissionWindowMs: 45_000,
  },
  Stage: {
    defaultNormal: 8,
    presets: [4, 8, 12],
    maxOverflow: 4,
    admissionWindowMs: 45_000,
  },
} as const satisfies Record<string, CapacityPolicy>;

export type RoomMember = {
  isBot: boolean;
  displayName: string;
  sequence: number;
};
export type Request = { id: number; generation: number } & (
  { state: "pending" } | { state: "approved"; expiresAt: number }
);
export type RoomState = {
  channelId: string;
  policy: CapacityPolicy;
  normalCapacity: number;
  members: Map<string, RoomMember>;
  hostId: string | null;
  generation: number;
  revision: number;
  nextSequence: number;
  nextRequest: number;
  creatorPending: string | null;
  requests: Map<string, Request>;
  closed: boolean;
  deleted: boolean;
};

export function createRoomState(
  channelId: string,
  creatorId: string,
  policy: CapacityPolicy,
): RoomState {
  if (
    !policy.presets.includes(policy.defaultNormal) ||
    policy.presets.some(
      (n) => !Number.isInteger(n) || n < 1 || n + policy.maxOverflow > 99,
    ) ||
    !Number.isInteger(policy.maxOverflow) ||
    policy.maxOverflow < 0 ||
    !Number.isFinite(policy.admissionWindowMs) ||
    policy.admissionWindowMs <= 0
  )
    throw new Error("Invalid room capacity policy.");
  return {
    channelId,
    policy,
    normalCapacity: policy.defaultNormal,
    members: new Map(),
    hostId: null,
    generation: 0,
    revision: 0,
    nextSequence: 0,
    nextRequest: 0,
    creatorPending: creatorId,
    requests: new Map(),
    closed: false,
    deleted: false,
  };
}

function changeHost(room: RoomState, hostId: string | null) {
  if (room.hostId === hostId) return;
  room.hostId = hostId;
  room.generation++;
  room.requests.clear();
  room.revision++;
}

/** Call only for observed presence. Unknown account types must not be passed as humans. */
export function enter(
  room: RoomState,
  id: string,
  member: Omit<RoomMember, "sequence">,
) {
  if (room.closed) return;
  const existing = room.members.get(id);
  if (existing) {
    if (
      existing.displayName !== member.displayName ||
      existing.isBot !== member.isBot
    ) {
      Object.assign(existing, member);
      room.revision++;
      if (!member.isBot && room.hostId === null) changeHost(room, id);
    }
    return;
  }
  room.members.set(id, { ...member, sequence: ++room.nextSequence });
  // Any observed entry consumes this member's approval, including normal-slot entry.
  room.requests.delete(id);
  room.revision++;
  if (!member.isBot && (room.hostId === null || room.creatorPending === id))
    changeHost(room, id);
  if (room.creatorPending === id) room.creatorPending = null;
}

export function leave(room: RoomState, id: string) {
  if (room.creatorPending === id) room.creatorPending = null;
  if (room.closed || !room.members.delete(id)) return;
  room.revision++;
  if (room.hostId === id) {
    const successor = [...room.members]
      .filter(([, member]) => !member.isBot)
      .sort((a, b) => a[1].sequence - b[1].sequence)[0];
    changeHost(room, successor?.[0] ?? null);
  }
}

function authorize(room: RoomState, actor: string, generation: number) {
  if (
    room.closed ||
    room.hostId !== actor ||
    room.generation !== generation ||
    room.members.get(actor)?.isBot !== false
  )
    throw new Error("Host action is no longer authorized.");
}
export function transferHost(
  room: RoomState,
  actor: string,
  target: string,
  generation: number,
) {
  authorize(room, actor, generation);
  if (room.members.get(target)?.isBot !== false)
    throw new Error("Target must be a human in this room.");
  room.creatorPending = null;
  changeHost(room, target);
}
export function resize(
  room: RoomState,
  actor: string,
  generation: number,
  capacity: number,
) {
  authorize(room, actor, generation);
  if (!room.policy.presets.includes(capacity))
    throw new Error("Unsupported capacity preset.");
  if (room.normalCapacity !== capacity) {
    room.normalCapacity = capacity;
    room.revision++;
  }
}
export function knock(room: RoomState, memberId: string) {
  if (room.closed || !room.hostId || room.members.has(memberId))
    throw new Error("Cannot knock on this room.");
  const existing = room.requests.get(memberId);
  if (existing) return existing.id;
  const request: Request = {
    id: ++room.nextRequest,
    generation: room.generation,
    state: "pending",
  };
  room.requests.set(memberId, request);
  room.revision++;
  return request.id;
}
export function decide(
  room: RoomState,
  actor: string,
  generation: number,
  memberId: string,
  requestId: number,
  allow: boolean,
  now: number,
) {
  authorize(room, actor, generation);
  const request = room.requests.get(memberId);
  if (
    !request ||
    request.id !== requestId ||
    request.generation !== generation ||
    request.state !== "pending"
  )
    throw new Error("Request is no longer pending.");
  if (allow)
    room.requests.set(memberId, {
      ...request,
      state: "approved",
      expiresAt: now + room.policy.admissionWindowMs,
    });
  else room.requests.delete(memberId);
  room.revision++;
}
/** Requester cancellation cannot cancel a newer replacement request. */
export function cancel(room: RoomState, memberId: string, requestId: number) {
  if (room.requests.get(memberId)?.id !== requestId) return;
  room.requests.delete(memberId);
  room.revision++;
}
export function expire(room: RoomState, now: number) {
  for (const [id, request] of room.requests)
    if (request.state === "approved" && request.expiresAt <= now) {
      room.requests.delete(id);
      room.revision++;
    }
}
export function closeRoom(room: RoomState, deleted = false) {
  room.closed = true;
  room.deleted ||= deleted;
  room.creatorPending = null;
  changeHost(room, null);
  room.requests.clear();
  room.revision++;
}
export function hostStatus(room: RoomState) {
  const host = room.hostId && room.members.get(room.hostId);
  return host
    ? `👑 ${host.displayName.replace(/[\r\n]/g, " ")}`.slice(0, 500)
    : null;
}

/** No occupancy <= capacity assumption: staff and bots are observed occupants too. */
export function desiredAdmission(room: RoomState, now: number) {
  const approved = [...room.requests]
    .filter(
      ([, r]) =>
        r.state === "approved" &&
        r.expiresAt > now &&
        r.generation === room.generation,
    )
    .map(([id]) => id);
  const needsOverflow =
    !room.closed &&
    room.members.size >= room.normalCapacity &&
    approved.length > 0;
  const limit = Math.max(
    room.normalCapacity,
    room.members.size + approved.length,
  );
  // Bounds include staff occupancy. Never silently consume approvals when headroom is exhausted.
  const canArm =
    needsOverflow &&
    limit <= Math.min(99, room.normalCapacity + room.policy.maxOverflow);
  return {
    grants: canArm ? approved : [],
    hardLimit: canArm ? limit : room.normalCapacity,
    closed: canArm,
  };
}

/** A lost Gateway session invalidates tenure; historical order cannot be recovered. */
export function resync(
  room: RoomState,
  members: readonly { id: string; isBot: boolean; displayName: string }[],
) {
  if (room.closed) return;
  room.requests.clear();
  room.generation++;
  room.revision++;
  room.creatorPending = null;
  const present = new Set(members.map((m) => m.id));
  for (const id of room.members.keys())
    if (!present.has(id)) room.members.delete(id);
  for (const member of members) {
    const existing = room.members.get(member.id);
    room.members.set(member.id, {
      isBot: member.isBot,
      displayName: member.displayName,
      sequence: existing?.sequence ?? ++room.nextSequence,
    });
  }
  if (room.hostId && room.members.get(room.hostId)?.isBot === false) return;
  changeHost(
    room,
    [...room.members]
      .filter(([, m]) => !m.isBot)
      .sort((a, b) => a[1].sequence - b[1].sequence)[0]?.[0] ?? null,
  );
}
