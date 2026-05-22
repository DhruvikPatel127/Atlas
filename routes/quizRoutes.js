const express = require('express');
const router = express.Router();
const quizController = require('../controllers/quizController');

router.post('/generate', quizController.generateQuiz);
router.get('/:noteId', quizController.getQuizzesByNoteId);

module.exports = router;
