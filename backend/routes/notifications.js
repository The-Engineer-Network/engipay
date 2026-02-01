/**
 * Notification Routes
 * Backend Dev 4 Task
 */

const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/notifications/email
 * Send email notification
 * Body: { to, subject, htmlContent, textContent }
 */
router.post('/email', authenticate, async (req, res) => {
  try {
    const { to, subject, htmlContent, textContent } = req.body;

    if (!to || !subject || !htmlContent) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'to, subject, and htmlContent are required'
        }
      });
    }

    const result = await notificationService.sendEmail(to, subject, htmlContent, textContent);

    res.json({
      success: result.success,
      data: result
    });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({
      error: {
        code: 'EMAIL_SEND_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/sms
 * Send SMS notification
 * Body: { to, message }
 */
router.post('/sms', authenticate, async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'to and message are required'
        }
      });
    }

    const result = await notificationService.sendSMS(to, message);

    res.json({
      success: result.success,
      data: result
    });
  } catch (error) {
    console.error('SMS send error:', error);
    res.status(500).json({
      error: {
        code: 'SMS_SEND_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/webhooks
 * Register a webhook
 * Body: { id, url, events, secret }
 */
router.post('/webhooks', authenticate, async (req, res) => {
  try {
    const { id, url, events, secret } = req.body;

    if (!id || !url || !events) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'id, url, and events are required'
        }
      });
    }

    const result = notificationService.registerWebhook(id, url, events, secret);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Webhook registration error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_REGISTRATION_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * DELETE /api/notifications/webhooks/:id
 * Unregister a webhook
 */
router.delete('/webhooks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = notificationService.unregisterWebhook(id);

    if (!result.success) {
      return res.status(404).json({
        error: {
          code: 'WEBHOOK_NOT_FOUND',
          message: 'Webhook not found'
        }
      });
    }

    res.json({
      success: true,
      message: 'Webhook unregistered successfully'
    });
  } catch (error) {
    console.error('Webhook unregistration error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_UNREGISTRATION_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/notifications/webhooks/:id
 * Get webhook details
 */
router.get('/webhooks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const webhook = notificationService.getWebhook(id);

    if (!webhook) {
      return res.status(404).json({
        error: {
          code: 'WEBHOOK_NOT_FOUND',
          message: 'Webhook not found'
        }
      });
    }

    res.json({
      success: true,
      data: webhook
    });
  } catch (error) {
    console.error('Webhook fetch error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/notifications/webhooks
 * List all webhooks
 */
router.get('/webhooks', authenticate, async (req, res) => {
  try {
    const webhooks = notificationService.listWebhooks();

    res.json({
      success: true,
      data: webhooks
    });
  } catch (error) {
    console.error('Webhooks list error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOKS_LIST_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/webhooks/trigger
 * Manually trigger webhook (for testing)
 * Body: { eventType, data }
 */
router.post('/webhooks/trigger', authenticate, async (req, res) => {
  try {
    const { eventType, data } = req.body;

    if (!eventType || !data) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'eventType and data are required'
        }
      });
    }

    const results = await notificationService.triggerWebhook(eventType, data);

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Webhook trigger error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_TRIGGER_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/transaction
 * Send transaction notification
 * Body: { userId, transaction, userEmail, userPhone }
 */
router.post('/transaction', authenticate, async (req, res) => {
  try {
    const { userId, transaction, userEmail, userPhone } = req.body;

    if (!userId || !transaction) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'userId and transaction are required'
        }
      });
    }

    const result = await notificationService.notifyTransaction(
      userId,
      transaction,
      userEmail,
      userPhone
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Transaction notification error:', error);
    res.status(500).json({
      error: {
        code: 'TRANSACTION_NOTIFICATION_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/swap
 * Send swap notification
 * Body: { userId, swap, userEmail }
 */
router.post('/swap', authenticate, async (req, res) => {
  try {
    const { userId, swap, userEmail } = req.body;

    if (!userId || !swap) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'userId and swap are required'
        }
      });
    }

    const result = await notificationService.notifySwap(userId, swap, userEmail);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Swap notification error:', error);
    res.status(500).json({
      error: {
        code: 'SWAP_NOTIFICATION_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/notifications/price-alert
 * Send price alert notification
 * Body: { userId, alert, userEmail, userPhone }
 */
router.post('/price-alert', authenticate, async (req, res) => {
  try {
    const { userId, alert, userEmail, userPhone } = req.body;

    if (!userId || !alert) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'userId and alert are required'
        }
      });
    }

    const result = await notificationService.notifyPriceAlert(
      userId,
      alert,
      userEmail,
      userPhone
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Price alert notification error:', error);
    res.status(500).json({
      error: {
        code: 'PRICE_ALERT_NOTIFICATION_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/notifications/event-types
 * Get available event types
 */
router.get('/event-types', async (req, res) => {
  try {
    res.json({
      success: true,
      data: notificationService.eventTypes
    });
  } catch (error) {
    console.error('Event types fetch error:', error);
    res.status(500).json({
      error: {
        code: 'EVENT_TYPES_ERROR',
        message: error.message
      }
    });
  }
});

module.exports = router;
