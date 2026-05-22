const express = require('express');
const router = express.Router();
const flashcardController = require('../controllers/flashcardController');

router.post('/generate', flashcardController.generateFlashcards);
router.get('/:noteId', flashcardController.getFlashcardsByNoteId);

module.exports = router;
