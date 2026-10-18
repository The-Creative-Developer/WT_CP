import { MAX_MESSAGE_LENGTH } from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export interface MessageAttrs {
  roomId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  createdAt: Date;
}

// [CONCEPT: Referencing for Unbounded Data] A room's chat grows without limit, so messages are their own documents
// rather than an array inside the room (which would eventually hit the 16 MB document limit).
const messageSchema = new Schema<MessageAttrs>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: MAX_MESSAGE_LENGTH },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Serves "this room's messages, newest first, older than <cursor>" without sorting in memory (PLAN §6).
messageSchema.index({ roomId: 1, createdAt: -1, _id: -1 });

export const Message = model<MessageAttrs>('Message', messageSchema);
