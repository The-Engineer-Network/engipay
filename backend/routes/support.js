const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const { Op } = require('sequelize');

const router = express.Router();

// POST /api/support/tickets - Create support ticket
router.post('/tickets', authenticateToken, [
  body('subject').isString().notEmpty().withMessage('Subject is required'),
  body('description').isString().notEmpty().withMessage('Description is required'),
  body('category').isIn(['technical', 'account', 'transaction', 'security', 'other']).withMessage('Invalid category'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent'])
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

    const { subject, description, category, priority = 'medium', attachments = [] } = req.body;
    const userId = req.user.id;

    // Generate ticket ID
    const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const ticket = await SupportTicket.create({
      ticket_id: ticketId,
      user_id: userId,
      subject,
      description,
      category,
      priority,
      attachments,
      metadata: {
        user_agent: req.headers['user-agent'],
        wallet_address: req.user.walletAddress
      }
    });

    res.status(201).json({
      ticket_id: ticket.ticket_id,
      status: ticket.status,
      priority: ticket.priority,
      estimated_response_time: '24 hours',
      created_at: ticket.created_at
    });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create support ticket'
      }
    });
  }
});

// GET /api/support/tickets - Get user tickets
router.get('/tickets', authenticateToken, [
  query('status').optional().isIn(['open', 'in_progress', 'waiting_response', 'resolved', 'closed']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;

    const where = { user_id: userId };
    if (status) where.status = status;

    const { count, rows: tickets } = await SupportTicket.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
      attributes: { exclude: ['description', 'metadata'] }
    });

    res.json({
      tickets,
      total_count: count
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch tickets'
      }
    });
  }
});

// GET /api/support/tickets/:id - Get ticket details
router.get('/tickets/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const ticket = await SupportTicket.findOne({
      where: {
        [Op.or]: [{ id }, { ticket_id: id }],
        user_id: userId
      }
    });

    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    // Get messages
    const messages = await SupportMessage.findAll({
      where: { ticket_id: ticket.id },
      order: [['created_at', 'ASC']]
    });

    res.json({
      ticket,
      messages
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch ticket'
      }
    });
  }
});

// POST /api/support/tickets/:id/messages - Add message to ticket
router.post('/tickets/:id/messages', authenticateToken, [
  body('message').isString().notEmpty().withMessage('Message is required')
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

    const { id } = req.params;
    const { message, attachments = [] } = req.body;
    const userId = req.user.id;

    const ticket = await SupportTicket.findOne({
      where: {
        [Op.or]: [{ id }, { ticket_id: id }],
        user_id: userId
      }
    });

    if (!ticket) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found'
        }
      });
    }

    const supportMessage = await SupportMessage.create({
      ticket_id: ticket.id,
      user_id: userId,
      message,
      attachments,
      is_staff: false
    });

    // Update ticket status
    if (ticket.status === 'waiting_response') {
      await ticket.update({ status: 'in_progress' });
    }

    res.status(201).json({
      message: supportMessage
    });
  } catch (error) {
    console.error('Error adding message:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to add message'
      }
    });
  }
});

// POST /api/support/chat/sessions - Start live chat
router.post('/chat/sessions', authenticateToken, [
  body('initial_message').isString().notEmpty().withMessage('Initial message is required')
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

    const { initial_message } = req.body;
    const userId = req.user.id;

    // Create a ticket for the chat session
    const ticketId = `CHAT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const ticket = await SupportTicket.create({
      ticket_id: ticketId,
      user_id: userId,
      subject: 'Live Chat Session',
      description: initial_message,
      category: 'other',
      priority: 'medium',
      metadata: {
        is_chat: true,
        user_agent: req.headers['user-agent']
      }
    });

    res.status(201).json({
      session_id: ticket.ticket_id,
      queue_position: 2,
      estimated_wait_time: '2 minutes',
      agent_available: false
    });
  } catch (error) {
    console.error('Error starting chat session:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to start chat session'
      }
    });
  }
});

module.exports = router;
