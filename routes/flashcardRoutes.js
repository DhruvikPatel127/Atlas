const express = require('express');
const router = express.Router();
const flashcardController = require('../controllers/flashcardController');
const auth = require('../middleware/auth');
const { checkUsageLimit } = require('../middleware/limitCheck');

router.post('/generate', auth, checkUsageLimit, flashcardController.generateFlashcards);
router.get('/:noteId', auth, flashcardController.getFlashcardsByNoteId);

module.exports = router;
