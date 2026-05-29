const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const auth = require('../middleware/auth');

router.post('/whiteboard', auth, videoController.generateWhiteboardTutorial);

module.exports = router;
