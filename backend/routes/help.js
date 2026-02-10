const express = require('express');
const { query } = require('express-validator');
const HelpArticle = require('../models/HelpArticle');
const HelpVideo = require('../models/HelpVideo');
const { Op } = require('sequelize');

const router = express.Router();

// GET /api/help/articles - Get help articles
router.get('/articles', [
  query('search').optional().isString(),
  query('category').optional().isIn(['basics', 'wallets', 'swaps', 'defi', 'security', 'troubleshooting']),
  query('difficulty').optional().isIn(['Beginner', 'Intermediate', 'Advanced']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const { search, category, difficulty, limit = 20, offset = 0 } = req.query;

    const where = { published: true };

    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (category) where.category = category;
    if (difficulty) where.difficulty = difficulty;

    const { count, rows: articles } = await HelpArticle.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['views', 'DESC'], ['created_at', 'DESC']],
      attributes: { exclude: ['content'] }
    });

    const categories = await HelpArticle.findAll({
      attributes: ['category'],
      where: { published: true },
      group: ['category']
    });

    res.json({
      articles,
      total_count: count,
      categories: categories.map(c => c.category)
    });
  } catch (error) {
    console.error('Error fetching help articles:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch help articles'
      }
    });
  }
});

// GET /api/help/articles/:id - Get specific article
router.get('/articles/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const article = await HelpArticle.findOne({
      where: {
        [Op.or]: [{ id }, { slug: id }],
        published: true
      }
    });

    if (!article) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Article not found'
        }
      });
    }

    // Increment view count
    await article.increment('views');

    res.json({ article });
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch article'
      }
    });
  }
});

// GET /api/help/videos - Get tutorial videos
router.get('/videos', [
  query('category').optional().isIn(['basics', 'wallets', 'swaps', 'defi', 'security']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const { category, limit = 20, offset = 0 } = req.query;

    const where = { published: true };
    if (category) where.category = category;

    const { count, rows: videos } = await HelpVideo.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['views', 'DESC'], ['created_at', 'DESC']]
    });

    res.json({
      videos,
      total_count: count
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch videos'
      }
    });
  }
});

module.exports = router;
