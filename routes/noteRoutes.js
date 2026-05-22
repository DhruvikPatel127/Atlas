const express = require('express');
const router = express.Router();
const noteController = require('../controllers/noteController');
const upload = require('../middleware/upload');

router.post('/upload', upload.single('file'), noteController.uploadNote);
router.get('/', noteController.getNotes);
router.get('/:id', noteController.getNoteById);

module.exports = router;
