const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const auth = require('../middleware/auth');
const { checkUsageLimit } = require('../middleware/limitCheck');

router.post('/send', auth, checkUsageLimit, chatController.sendMessage);
router.get('/:noteId', auth, chatController.getChatByNoteId);

module.exports = router;
