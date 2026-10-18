import type { CreateRoomInput, JoinRoomInput, ListMessagesQuery } from '@devverse/shared';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { validQuery } from '../middleware/validate';
import * as chat from '../services/chat';
import * as rooms from '../services/rooms';

type SlugParams = { slug: string };

export const listRooms: RequestHandler = async (req, res) => {
  res.json(await rooms.listRooms(currentUser(req).id));
};

export const createRoom: RequestHandler = async (req, res) => {
  const room = await rooms.createRoom(currentUser(req).id, req.body as CreateRoomInput);
  res.location(`/api/v1/rooms/${room.slug}`).status(201).json(room);
};

export const getRoom: RequestHandler<SlugParams> = async (req, res) => {
  res.json(await rooms.getRoom(currentUser(req).id, req.params.slug));
};

export const joinRoom: RequestHandler<SlugParams> = async (req, res) => {
  const { inviteCode } = req.body as JoinRoomInput;
  res.json(await rooms.joinRoom(currentUser(req).id, req.params.slug, inviteCode));
};

export const deleteRoom: RequestHandler<SlugParams> = async (req, res) => {
  await rooms.deleteRoom(currentUser(req).id, req.params.slug);
  // [CONCEPT: 204 No Content] Success with nothing to send back.
  res.status(204).end();
};

// [CONCEPT: Cursor Pagination] ?before=<cursor> pages backwards through the chat; see services/chat.ts.
export const listMessages: RequestHandler<SlugParams> = async (req, res) => {
  const query = validQuery<ListMessagesQuery>(res);
  res
    .set('Cache-Control', 'no-store')
    .json(await chat.listMessages(currentUser(req), req.params.slug, query));
};
