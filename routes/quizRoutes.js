const express = require('express');
const router = express.Router();
const quizController = require('../controllers/quizController');
const auth = require('../middleware/auth');
const { checkUsageLimit } = require('../middleware/limitCheck');

router.post('/generate', auth, checkUsageLimit, quizController.generateQuiz);
router.get('/:noteId', auth, quizController.getQuizzesByNoteId);
router.post('/submit-score', auth, quizController.submitQuizScore);
router.get('/stats', auth, quizController.getUserStats);

module.exports = router;
