const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');
const auth = require('../middleware/auth');

router.post('/generate', auth, videoController.generateAvatarVideo);

module.exports = router;
