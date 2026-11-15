import type {
  CreateCommentInput,
  CreateReviewInput,
  ListReviewsQuery,
  UpdateCommentInput,
  UpdateReviewInput,
} from '@devverse/shared';
import type { RequestHandler } from 'express';
import { currentUser } from '../middleware/auth';
import { validQuery } from '../middleware/validate';
import * as reviews from '../services/reviews';

type ReviewParams = { id: string };
type CommentParams = ReviewParams & { commentId: string };

export const createReview: RequestHandler = async (req, res) => {
  const review = await reviews.createReview(currentUser(req), req.body as CreateReviewInput);
  res.location(`/api/v1/reviews/${review.id}`).status(201).json(review);
};

export const listReviews: RequestHandler = async (req, res) => {
  const query = validQuery<ListReviewsQuery>(res);
  res.set('Cache-Control', 'no-store').json(await reviews.listReviews(currentUser(req), query));
};

export const getReview: RequestHandler<ReviewParams> = async (req, res) => {
  res
    .set('Cache-Control', 'no-store')
    .json(await reviews.getReview(currentUser(req), req.params.id));
};

export const updateReview: RequestHandler<ReviewParams> = async (req, res) => {
  const { status } = req.body as UpdateReviewInput;
  res.json(await reviews.updateReview(currentUser(req), req.params.id, status));
};

export const addComment: RequestHandler<ReviewParams> = async (req, res) => {
  const { id } = req.params;
  const comment = await reviews.addComment(currentUser(req), id, req.body as CreateCommentInput);
  res.location(`/api/v1/reviews/${id}/comments/${comment.id}`).status(201).json(comment);
};

export const updateComment: RequestHandler<CommentParams> = async (req, res) => {
  const { id, commentId } = req.params;
  res.json(
    await reviews.updateComment(currentUser(req), id, commentId, req.body as UpdateCommentInput),
  );
};
