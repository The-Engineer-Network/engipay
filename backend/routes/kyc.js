const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const KYCVerification = require('../models/KYCVerification');

const router = express.Router();

// POST /api/users/kyc/submit - Submit KYC documents
router.post('/submit', authenticateToken, [
  body('document_type').isIn(['passport', 'drivers_license', 'national_id']).withMessage('Invalid document type'),
  body('personal_info').isObject().withMessage('Personal info is required'),
  body('personal_info.full_name').isString().notEmpty(),
  body('personal_info.date_of_birth').isString().notEmpty(),
  body('personal_info.address').isString().notEmpty()
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

    const { document_type, personal_info, documents = [] } = req.body;
    const userId = req.user.id;

    let kyc = await KYCVerification.findOne({
      where: { user_id: userId }
    });

    if (kyc) {
      // Update existing KYC
      await kyc.update({
        status: 'pending',
        document_type,
        personal_info,
        documents,
        submitted_at: new Date()
      });
    } else {
      // Create new KYC
      kyc = await KYCVerification.create({
        user_id: userId,
        status: 'pending',
        document_type,
        personal_info,
        documents,
        submitted_at: new Date()
      });
    }

    res.json({
      kyc_id: kyc.id,
      status: kyc.status,
      estimated_completion: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      required_documents: [document_type, 'proof_of_address']
    });
  } catch (error) {
    console.error('Error submitting KYC:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to submit KYC'
      }
    });
  }
});

// GET /api/users/kyc/status - Get KYC status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const kyc = await KYCVerification.findOne({
      where: { user_id: userId }
    });

    if (!kyc) {
      return res.json({
        kyc_id: null,
        status: 'not_started',
        verification_level: null,
        limits: {
          daily_transaction: 1000,
          monthly_transaction: 10000
        }
      });
    }

    res.json({
      kyc_id: kyc.id,
      status: kyc.status,
      verification_level: kyc.verification_level,
      limits: kyc.limits,
      verified_at: kyc.verified_at,
      submitted_at: kyc.submitted_at
    });
  } catch (error) {
    console.error('Error fetching KYC status:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch KYC status'
      }
    });
  }
});

// GET /api/users/limits - Get transaction limits based on KYC
router.get('/limits', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const kyc = await KYCVerification.findOne({
      where: { user_id: userId }
    });

    let limits = {
      daily_transaction: 1000,
      monthly_transaction: 10000,
      kyc_required_for_higher: true
    };

    if (kyc && kyc.status === 'verified') {
      limits = {
        ...kyc.limits,
        kyc_required_for_higher: false,
        verification_level: kyc.verification_level
      };
    }

    res.json({ limits });
  } catch (error) {
    console.error('Error fetching limits:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch limits'
      }
    });
  }
});

module.exports = router;
