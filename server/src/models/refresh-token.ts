import { model, Schema, type Types } from 'mongoose';

export interface RefreshTokenAttrs {
  userId: Types.ObjectId;
  /** HMAC of the token. The token itself is only ever in the user's cookie. */
  tokenHash: string;
  /** Every token produced by rotating one login shares a family, so a whole session can be revoked at once. */
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    // [CONCEPT: Referencing] Tokens point at their user instead of being embedded: a user can have many sessions.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// [CONCEPT: TTL Index] MongoDB deletes each token automatically once expiresAt has passed.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema);
