import argon2 from 'argon2';
import { model, Schema, type HydratedDocument, type Model } from 'mongoose';

export interface UserAttrs {
  username: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
  bio: string;
  stats: { solved: number; xp: number };
  createdAt: Date;
  updatedAt: Date;
}

interface UserMethods {
  verifyPassword(plain: string): Promise<boolean>;
}

type UserModel = Model<UserAttrs, object, UserMethods>;
export type UserDocument = HydratedDocument<UserAttrs, UserMethods>;

// Case-insensitive comparison ("Alice" and "alice" are the same username).
export const CASE_INSENSITIVE = { locale: 'en', strength: 2 } as const;

// Where the plain-text password waits between `user.password = ...` and the hashing hook. Never persisted.
const plainPassword = Symbol('plainPassword');

const userSchema = new Schema<UserAttrs, UserModel, UserMethods>(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-z0-9_-]+$/i,
    },
    // Stored lowercased, so a plain unique index is enough for case-insensitive uniqueness.
    email: { type: String, required: true, trim: true, lowercase: true },
    // [CONCEPT: Projection] select:false keeps the hash out of every query unless explicitly asked for.
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String },
    bio: { type: String, default: '', maxlength: 280 },
    // [CONCEPT: Embedded Documents] Small and always read with the profile, so stats live inside the user.
    stats: {
      type: new Schema({ solved: Number, xp: Number }, { _id: false }),
      default: () => ({ solved: 0, xp: 0 }),
    },
  },
  { timestamps: true },
);

// [CONCEPT: Unique Indexes + Collation] Usernames keep their display casing but must be unique ignoring case.
userSchema.index({ username: 1 }, { unique: true, collation: CASE_INSENSITIVE });
userSchema.index({ email: 1 }, { unique: true });

// [CONCEPT: Mongoose Virtuals] `password` looks like a field but is never stored; the hook below turns it into a hash.
userSchema.virtual('password').set(function (
  this: UserDocument & { [plainPassword]?: string },
  value: string,
) {
  this[plainPassword] = value;
});

// [CONCEPT: Mongoose Middleware (hooks)] Hash before validation so the required passwordHash check passes.
userSchema.pre('validate', async function () {
  const doc = this as UserDocument & { [plainPassword]?: string };
  const plain = doc[plainPassword];
  if (plain === undefined) return;
  // [CONCEPT: Password Hashing] argon2id is memory-hard, so GPU brute-forcing a leaked hash is expensive.
  doc.passwordHash = await argon2.hash(plain, { type: argon2.argon2id });
  delete doc[plainPassword];
});

userSchema.method('verifyPassword', function (this: UserDocument, plain: string) {
  return argon2.verify(this.passwordHash, plain);
});

export const User = model<UserAttrs, UserModel>('User', userSchema);
