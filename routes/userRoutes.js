const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/me', auth, userController.getMe);
router.post('/subjects', auth, userController.addSubject);
router.post('/roadmap', auth, userController.getRoadmap);

module.exports = router;
