import type { PublicUser, SelfUser } from '@devverse/shared';
import type { UserAttrs } from '../models/user';

type UserLike = Pick<UserAttrs, 'username' | 'avatarUrl' | 'bio'> & { _id: { toString(): string } };

// [CONCEPT: DTOs] Responses are built field by field, so a new model field (or the password hash) never leaks by accident.
export function toPublicUser(user: UserLike): PublicUser {
  return {
    id: user._id.toString(),
    username: user.username,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    ...(user.bio ? { bio: user.bio } : {}),
  };
}

export function toSelfUser(
  user: UserLike & Pick<UserAttrs, 'email' | 'stats' | 'createdAt'>,
): SelfUser {
  return {
    ...toPublicUser(user),
    email: user.email,
    stats: { solved: user.stats?.solved ?? 0, xp: user.stats?.xp ?? 0 },
    createdAt: user.createdAt.toISOString(),
  };
}
