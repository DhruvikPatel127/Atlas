const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.post('/send', chatController.sendMessage);
router.get('/:noteId', chatController.getChatByNoteId);

module.exports = router;
