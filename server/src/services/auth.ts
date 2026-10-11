import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { LoginInput, RegisterInput } from '@devverse/shared';
import argon2 from 'argon2';
import { jwtVerify, SignJWT } from 'jose';
import { RefreshToken } from '../models/refresh-token';
import { User, type UserDocument } from '../models/user';
import { HttpError } from '../utils/http-error';
import { logger } from '../utils/logger';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ISSUER = 'devverse-api';
const AUDIENCE = 'devverse-web';

export interface AuthUser {
  id: string;
  username: string;
}

export interface Session {
  user: UserDocument;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface AuthSecrets {
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(secrets: AuthSecrets) {
  const accessKey = new TextEncoder().encode(secrets.JWT_ACCESS_SECRET);

  // [CONCEPT: Keyed Hashing (HMAC)] Even with a copy of the database, nobody can check a guessed token without the server secret.
  const hashRefreshToken = (token: string) =>
    createHmac('sha256', secrets.JWT_REFRESH_SECRET).update(token).digest('base64url');

  // [CONCEPT: JSON Web Tokens] A signed, self-contained claim; the API verifies it without a database lookup.
  function signAccessToken(user: UserDocument) {
    return new SignJWT({ username: user.username })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(accessKey);
  }

  async function verifyAccessToken(token: string): Promise<AuthUser> {
    // Pinning the algorithm blocks "alg: none" and algorithm-confusion attacks.
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.username !== 'string') {
      throw new Error('Malformed access token');
    }
    return { id: payload.sub, username: payload.username };
  }

  async function startSession(user: UserDocument, family: string = randomUUID()): Promise<Session> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await RefreshToken.create({
      userId: user._id,
      tokenHash: hashRefreshToken(refreshToken),
      family,
      expiresAt: refreshExpiresAt,
    });
    return { user, accessToken: await signAccessToken(user), refreshToken, refreshExpiresAt };
  }

  // Verifying against a throwaway hash when the email is unknown makes both failure paths take the same time,
  // so response timing can't reveal which emails have accounts.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= argon2.hash(randomUUID(), { type: argon2.argon2id }));

  return {
    verifyAccessToken,

    async register(input: RegisterInput): Promise<Session> {
      const user = new User({ username: input.username, email: input.email });
      user.set('password', input.password);
      try {
        await user.save();
      } catch (err) {
        throw duplicateKeyToConflict(err);
      }
      return startSession(user);
    },

    async login({ email, password }: LoginInput): Promise<Session> {
      const user = await User.findOne({ email }).select('+passwordHash');
      const valid = user
        ? await user.verifyPassword(password)
        : await argon2.verify(await getDummyHash(), password).then(() => false);
      // [CONCEPT: Generic Auth Errors] One message for both cases, so attackers can't probe which emails exist.
      if (!user || !valid) throw HttpError.unauthorized('Invalid email or password');
      return startSession(user);
    },

    // [CONCEPT: Refresh Token Rotation] Every refresh consumes the old token and issues a new one in the same family.
    async refresh(presented: string | undefined): Promise<Session> {
      if (!presented) throw HttpError.unauthorized('No active session');
      const tokenHash = hashRefreshToken(presented);
      const now = new Date();

      // [CONCEPT: Atomic findOneAndUpdate] Claim the token in one step, so two concurrent refreshes can't both succeed.
      const claimed = await RefreshToken.findOneAndUpdate(
        { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
      );

      if (!claimed) {
        // [CONCEPT: Token Reuse Detection] A consumed token showing up again means it was copied. Revoke the whole
        // family so both the thief and the real user must log in again.
        const reused = await RefreshToken.findOne({ tokenHash, revokedAt: { $ne: null } });
        if (reused) {
          await RefreshToken.updateMany(
            { family: reused.family, revokedAt: null },
            { $set: { revokedAt: now } },
          );
          logger.warn(
            { userId: reused.userId, family: reused.family },
            'Refresh token reuse detected',
          );
        }
        throw HttpError.unauthorized('Session expired, please log in again');
      }

      const user = await User.findById(claimed.userId);
      if (!user) throw HttpError.unauthorized('Session expired, please log in again');
      return startSession(user, claimed.family);
    },

    async logout(presented: string | undefined): Promise<void> {
      if (!presented) return;
      const token = await RefreshToken.findOne({ tokenHash: hashRefreshToken(presented) });
      if (token) {
        await RefreshToken.updateMany(
          { family: token.family, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
      }
    },
  };
}

function duplicateKeyToConflict(err: unknown): unknown {
  if (!(err instanceof Error) || (err as { code?: number }).code !== 11000) return err;
  const field = Object.keys((err as { keyPattern?: object }).keyPattern ?? {})[0];
  const message =
    field === 'username' ? 'That username is taken' : 'An account with that email already exists';
  return HttpError.conflict(message, field ? { [field]: [message] } : undefined);
}
