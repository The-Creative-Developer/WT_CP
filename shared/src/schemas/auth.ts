import { z } from 'zod';

// [CONCEPT: Shared Validation] The same Zod schema validates the form in the browser and the request body on the server.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(/^[a-z0-9_-]+$/i, 'Use only letters, numbers, "-" and "_"');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

export const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

// [CONCEPT: PATCH Semantics] Every field is optional: the client sends only what changed.
export const updateMeSchema = z
  .object({
    bio: z.string().trim().max(280, 'Bio must be at most 280 characters'),
    avatarUrl: z
      .string()
      .trim()
      .url('Enter a valid URL')
      .refine((url) => url.startsWith('https://'), 'Avatar URL must use https')
      .or(z.literal('')),
  })
  .partial()
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export interface PublicUser {
  id: string;
  username: string;
  avatarUrl?: string;
  bio?: string;
}

/** The signed-in user's own profile: includes private fields such as email. */
export interface SelfUser extends PublicUser {
  email: string;
  stats: { solved: number; xp: number };
  createdAt: string;
}

/** Body returned by register, login and refresh. The refresh token travels separately in an httpOnly cookie. */
export interface AuthResponse {
  user: SelfUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}
