const express = require('express');
const router = express.Router();
const flashcardController = require('../controllers/flashcardController');
const auth = require('../middleware/auth');

router.post('/generate', auth, flashcardController.generateFlashcards);
router.get('/:noteId', auth, flashcardController.getFlashcardsByNoteId);

module.exports = router;
