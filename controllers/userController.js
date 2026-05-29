const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'ID Token is required' });

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { name, email, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ email });

    if (!user) {
      // Create a new user if not exists
      // Generate a random password since it's required in model but not used for Google users
      const randomPassword = Math.random().toString(36).slice(-10);
      user = new User({
        name,
        email,
        password: randomPassword,
        subjects: [],
      });
      await user.save();
    }

    const payload = { user: { id: user.id } };
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_atlas_app_2026';
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        subjects: user.subjects,
      },
    });
  } catch (err) {
    console.error('Google Login Error:', err.message);
    res.status(500).json({ message: 'Server error during Google login', error: err.message });
  }
};

const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });

    user = new User({ name, email, password, subjects: [] });
    await user.save();

    const payload = { user: { id: user.id } };
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_atlas_app_2026';
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, subjects: user.subjects } });
  } catch (err) {
    console.error('Registration Error:', err.message);
    res.status(500).json({ message: 'Server error during registration', error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const payload = { user: { id: user.id } };
    const secret = process.env.JWT_SECRET || 'fallback_secret_for_atlas_app_2026';
    const token = jwt.sign(payload, secret, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, subjects: user.subjects } });
  } catch (err) {
    console.error('Login Error:', err.message);
    res.status(500).json({ message: 'Server error during login', error: err.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const addSubject = async (req, res) => {
  try {
    const { subject } = req.body;
    const user = await User.findById(req.user.id);
    if (!user.subjects.includes(subject)) {
      user.subjects.push(subject);
      await user.save();
    }
    res.json(user.subjects);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const generateStudyPlan = async (req, res) => {
  try {
    const { examDate, examTitle, subjects } = req.body;
    const userId = req.user.id || req.user._id;

    const { generateContent } = require('./geminiController');
    const prompt = `Create a study plan for '${examTitle}' on ${examDate}.
    Subjects: ${subjects.join(', ')}.
    The response MUST be a JSON object with this structure:
    {"planTitle": "Study Plan", "days": [{"day": "Day 1", "tasks": ["Task 1"]}]} `;

    const aiResponse = await generateContent(prompt, 'planner', 1, true);
    let planData;
    try {
      planData = JSON.parse(aiResponse);
    } catch (error) {
      console.error('Study planner error:', error);
      throw new Error('AI failed to generate a valid study plan. Please try again.');
    }
    
    res.json(planData);
  } catch (error) {
    console.error('Study planner error:', error);
    res.status(500).json({ message: 'Error generating study plan', error: error.message });
  }
};

module.exports = { register, login, getMe, addSubject, googleLogin, generateStudyPlan };
