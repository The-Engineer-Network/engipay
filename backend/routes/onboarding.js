const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const UserOnboarding = require('../models/UserOnboarding');

const router = express.Router();

// POST /api/users/onboarding/complete - Mark onboarding complete
router.post('/complete', authenticateToken, [
  body('steps_completed').isArray().withMessage('Steps completed must be an array'),
  body('completion_time').optional().isInt(),
  body('skipped_steps').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { steps_completed, completion_time, skipped_steps = [], user_feedback } = req.body;
    const userId = req.user.id;

    let onboarding = await UserOnboarding.findOne({
      where: { user_id: userId }
    });

    if (!onboarding) {
      onboarding = await UserOnboarding.create({
        user_id: userId,
        steps_completed: [],
        completion_percentage: 0
      });
    }

    // Update onboarding
    await onboarding.update({
      is_completed: true,
      steps_completed,
      completion_percentage: 100,
      completed_at: new Date(),
      metadata: {
        completion_time,
        skipped_steps,
        user_feedback
      }
    });

    res.json({
      onboarding_id: onboarding.id,
      completed_at: onboarding.completed_at,
      completion_rate: 100,
      next_recommended_action: 'make_first_payment'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to complete onboarding'
      }
    });
  }
});

// GET /api/users/onboarding/status - Get onboarding progress
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let onboarding = await UserOnboarding.findOne({
      where: { user_id: userId }
    });

    if (!onboarding) {
      // Create new onboarding record
      onboarding = await UserOnboarding.create({
        user_id: userId,
        steps_completed: [],
        completion_percentage: 0
      });
    }

    res.json({
      is_completed: onboarding.is_completed,
      steps_completed: onboarding.steps_completed,
      current_step: onboarding.current_step,
      completion_percentage: onboarding.completion_percentage,
      started_at: onboarding.started_at
    });
  } catch (error) {
    console.error('Error fetching onboarding status:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch onboarding status'
      }
    });
  }
});

module.exports = router;
