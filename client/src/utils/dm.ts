export function getDmRoomId(u1: string, u2: string): string {
  const sorted = [u1.trim().toLowerCase(), u2.trim().toLowerCase()].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

export function isDmRoom(room: string): boolean {
  return room.startsWith('dm:');
}

export function getDmPeerUsername(room: string, currentUsername: string): string | null {
  if (!isDmRoom(room)) return null;
  const parts = room.split(':');
  if (parts.length !== 3) return null;
  const current = currentUsername.trim().toLowerCase();
  if (parts[1] === current) return parts[2];
  if (parts[2] === current) return parts[1];
  return parts[1];
}
