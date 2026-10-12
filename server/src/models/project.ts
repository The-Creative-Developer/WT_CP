import { LANGUAGE_IDS, type Language } from '@devverse/shared';
import { model, Schema, type Types } from 'mongoose';

export interface ProjectAttrs {
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  language: Language;
  isPublic: boolean;
  forkedFrom: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<ProjectAttrs>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 500 },
    language: { type: String, enum: LANGUAGE_IDS, required: true },
    isPublic: { type: Boolean, default: false },
    forkedFrom: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true },
);

// [CONCEPT: Compound Index] Serves "my projects, newest first" with one index walk and no in-memory sort.
projectSchema.index({ ownerId: 1, updatedAt: -1 });
// [CONCEPT: Text Index] Enables $text search over project names and descriptions.
// Gotcha: a text index reads any field called "language" as the *human* language for stemming, so "python" would be
// rejected. Point that override at a field we never set.
projectSchema.index(
  { name: 'text', description: 'text' },
  { language_override: 'textSearchLanguage', default_language: 'english' },
);

export const Project = model<ProjectAttrs>('Project', projectSchema);
