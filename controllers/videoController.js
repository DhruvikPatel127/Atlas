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

const generateWhiteboardTutorial = async (req, res) => {
  try {
    const { noteId } = req.body;
    const userId = req.user.id || req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const { generateContent } = require('./geminiController');
    const prompt = `Act as an expert teacher. Create a step-by-step whiteboard explanation for these notes.
    For each step, provide:
    - title: A very short name for this step.
    - writing: Exactly what you would write on a board (use simplified math, keywords, or formulas).
    - narration: A clear, encouraging spoken explanation for this step.

    Notes: ${note.content}

    The response MUST be a single, valid JSON object with this exact structure:
    {"steps": [{"title": "Step Name", "writing": "Text on board", "narration": "Spoken explanation"}]}
    
    IMPORTANT: Escape all special characters and do not use newlines within JSON strings.`;

    const aiResponse = await generateContent(prompt, 'whiteboard_script', 1, true);
    
    let scriptData;
    try {
      // 1. Clean common AI noise and ensure valid JSON
      let cleaned = aiResponse.replace(/```json|```/g, '').trim();
      
      // 2. Handle potential raw newlines inside strings that break JSON.parse
      // This regex looks for newlines that are NOT escaped
      cleaned = cleaned.replace(/\n/g, '\\n');
      
      // 3. Find the outermost brackets to extract JSON
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const jsonPart = cleaned.substring(start, end + 1);
        scriptData = JSON.parse(jsonPart);
      } else {
        throw new Error("No JSON structure found");
      }
    } catch (parseError) {
      console.error('Whiteboard JSON Parse Error. Raw Response:', aiResponse);
      // Final attempt: manual extraction of steps if the structure is broken but contains objects
      try {
        const steps = [];
        const stepMatches = aiResponse.match(/\{"title":[^}]+\}/g);
        if (stepMatches) {
          stepMatches.forEach(m => {
            try { steps.push(JSON.parse(m.replace(/\n/g, '\\n'))); } catch(e){}
          });
          scriptData = { steps };
        } else {
          throw new Error("Failed to reconstruct steps");
        }
      } catch (fallbackError) {
        throw new Error('AI failed to generate a valid whiteboard session. Please try again.');
      }
    }

    res.json(scriptData);
  } catch (error) {
    console.error('Whiteboard Engine Error:', error.message);
    res.status(500).json({ message: 'Error generating whiteboard script', error: error.message });
  }
};

module.exports = { generateAvatarVideo, generateWhiteboardTutorial };
