import { User } from './schemas/user.schema';

// The public profile shape returned by GET /users/:id and the avatar routes
// (spec 0005 AC-4), kept in one place so both stay in sync.
export function toUserProfile(user: User) {
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatar: user.avatar ?? null,
    role: user.role,
    subscription: user.subscription,
    createdAt: user.createdAt,
  };
}
