import {
  createCommentSchema,
  createReviewSchema,
  listReviewsQuerySchema,
  updateCommentSchema,
  updateReviewSchema,
} from '@devverse/shared';
import { Router, type RequestHandler } from 'express';
import * as controller from '../controllers/reviews';
import { validateBody, validateQuery } from '../middleware/validate';

/**
 * Code review: a snapshot compared with an earlier one, with comment threads anchored to its lines. Editors request
 * reviews; any member of the room can read and comment.
 */
export function createReviewsRouter(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  router.post('/', validateBody(createReviewSchema), controller.createReview);
  router.get('/', validateQuery(listReviewsQuerySchema), controller.listReviews);
  router.get('/:id', controller.getReview);
  router.patch('/:id', validateBody(updateReviewSchema), controller.updateReview);
  router.post('/:id/comments', validateBody(createCommentSchema), controller.addComment);
  router.patch(
    '/:id/comments/:commentId',
    validateBody(updateCommentSchema),
    controller.updateComment,
  );

  return router;
}
