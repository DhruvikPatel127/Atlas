const express = require('express');
const router = express.Router();
const noteController = require('../controllers/noteController');
const upload = require('../middleware/upload');
const auth = require('../middleware/auth');
const { checkDocumentLimit } = require('../middleware/limitCheck');

router.post('/upload', auth, checkDocumentLimit, upload.single('file'), noteController.uploadNote);
router.get('/', auth, noteController.getNotes);
router.get('/:id', auth, noteController.getNoteById);

module.exports = router;
