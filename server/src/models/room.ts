import {
  LANGUAGE_IDS,
  MAX_ROOM_MEMBERS,
  ROOM_ROLES,
  ROOM_VISIBILITIES,
  type Language,
  type RoomRole,
  type RoomVisibility,
} from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export interface RoomMemberAttrs {
  userId: Types.ObjectId;
  role: RoomRole;
  joinedAt: Date;
}

export interface RoomAttrs {
  slug: string;
  name: string;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  language: Language;
  visibility: RoomVisibility;
  inviteCode: string;
  members: RoomMemberAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

const memberSchema = new Schema<RoomMemberAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROOM_ROLES, required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const roomSchema = new Schema<RoomAttrs>(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 60 },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    language: { type: String, enum: LANGUAGE_IDS, required: true },
    visibility: { type: String, enum: ROOM_VISIBILITIES, default: 'private' },
    // Only the owner ever sees this, so keep it out of queries by default.
    inviteCode: { type: String, required: true, select: false },
    // [CONCEPT: Embedded Arrays] Members are always loaded with the room and capped at 10, so they live inside it.
    members: {
      type: [memberSchema],
      validate: {
        validator: (members: unknown[]) => members.length <= MAX_ROOM_MEMBERS,
        message: `A room can have at most ${MAX_ROOM_MEMBERS} members`,
      },
    },
  },
  { timestamps: true },
);

roomSchema.index({ slug: 1 }, { unique: true });
// [CONCEPT: Multikey Index] Indexing a field inside an array indexes every element, so "rooms I belong to" is fast.
roomSchema.index({ 'members.userId': 1, updatedAt: -1 });

// [CONCEPT: Mongoose Virtuals] Derived from the members array; never stored, so it can't drift out of sync.
roomSchema.virtual('memberCount').get(function () {
  return this.members.length;
});

export const Room = model<RoomAttrs>('Room', roomSchema);
