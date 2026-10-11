import type { UpdateMeInput } from '@devverse/shared';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { User } from '../models/user';
import { HttpError } from '../utils/http-error';
import { toSelfUser } from '../utils/user-dto';

export const getMe: RequestHandler = async (req, res) => {
  // [CONCEPT: lean()] Returns a plain object instead of a full Mongoose document: faster for read-only responses.
  const user = await User.findById(currentUser(req).id).lean();
  // The token is valid but the account is gone (deleted since it was issued).
  if (!user) throw HttpError.unauthorized('Account no longer exists');
  res.set('Cache-Control', 'private, no-cache');
  res.json(toSelfUser(user));
};

export const updateMe: RequestHandler = async (req, res) => {
  const changes = req.body as UpdateMeInput;
  // [CONCEPT: $set + runValidators] Only the sent fields change, and schema rules still apply to them.
  const user = await User.findByIdAndUpdate(
    currentUser(req).id,
    { $set: changes },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!user) throw HttpError.unauthorized('Account no longer exists');
  res.json(toSelfUser(user));
};
