const express = require('express');
const router = express.Router();
const quizController = require('../controllers/quizController');
const auth = require('../middleware/auth');

router.post('/generate', auth, quizController.generateQuiz);
router.get('/:noteId', auth, quizController.getQuizzesByNoteId);

module.exports = router;
