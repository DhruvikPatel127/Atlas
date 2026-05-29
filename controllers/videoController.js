const axios = require('axios');
const Note = require('../models/Note');

const generateAvatarVideo = async (req, res) => {
  try {
    const { noteId } = req.body;
    const userId = req.user.id || req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });
    if (!note) return res.status(404).json({ message: 'Note not found' });

    // 1. Generate a "Motion Graphics Script" using Gemini
    // This is free and doesn't require external paid video APIs
    const { generateContent } = require('./geminiController');
    const prompt = `Convert these study notes into a professional animated tutorial script.
    Break it into 4-6 scenes. For each scene, provide:
    - title: A short heading for the slide.
    - content: 2-3 key bullet points.
    - narration: The text the AI tutor should speak.
    - icon: A relevant icon name from Material Icons (e.g., 'school', 'science', 'calculate').

    Notes: ${note.content}

    Return ONLY a JSON object: {"scenes": [{"title": "", "content": [], "narration": "", "icon": ""}]}`;

    const aiResponse = await generateContent(prompt, 'motion_script', 1, true);
    const scriptData = JSON.parse(aiResponse);

    res.json(scriptData);
  } catch (error) {
    console.error('Motion Engine Error:', error.message);
    res.status(500).json({ message: 'Error generating tutorial script', error: error.message });
  }
};

module.exports = { generateAvatarVideo };
