// [CONCEPT: Role-Based Access Control] Room roles are ordered so permission checks become a simple comparison.
export const ROOM_ROLES = ['viewer', 'editor', 'owner'] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export function hasRoomRole(actual: RoomRole, required: RoomRole): boolean {
  return ROOM_ROLES.indexOf(actual) >= ROOM_ROLES.indexOf(required);
}
