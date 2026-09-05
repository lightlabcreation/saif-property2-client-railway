const express = require('express');
const router = express.Router();
const { executeAiSql } = require('./internal.controller');

// @route   POST /api/internal/ai-execute
router.post('/ai-execute', executeAiSql);

module.exports = router;
