const axios = require('axios');
const Note = require('../models/Note');

const generateWhiteboardTutorial = async (req, res) => {
  try {
    const { noteId } = req.body;
    const userId = req.user.id || req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const { generateContent } = require('./geminiController');
    const prompt = `Act as an expert teacher conducting a deep-dive classroom session. 
    Explain the following notes in a way that ensures the student develops a deep understanding, not just memorization.
    
    Structure the tutorial into 3-4 comprehensive steps. For each step:
    - title: A short, professional heading.
    - writing: Exactly what you would draw or write on the whiteboard (formulas, diagrams described in text, or structured bullet points).
    - narration: A detailed, conversational, and insightful explanation. Start with 'Now, let's look at...' or 'To truly understand this, we need to...'. Use an encouraging teacher's tone.

    Notes: ${note.content}

    The response MUST be a single, valid JSON object:
    {"steps": [{"title": "Concept Foundation", "writing": "Main Formula/Rule", "narration": "Deep explanation text"}]} `;

    const aiResponse = await generateContent(prompt, 'whiteboard_script', 1, true);
    
    let scriptData;
    try {
      // 1. Clean common AI noise
      let cleaned = aiResponse.replace(/```json|```/g, '').trim();
      
      // 2. Find the FIRST { and the LAST } to ensure we have a full object
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      
      if (start !== -1 && end !== -1) {
        let jsonPart = cleaned.substring(start, end + 1);
        
        // 3. Fix potential internal unescaped newlines BEFORE parsing
        // This is a common AI error where it puts real enters inside JSON strings
        jsonPart = jsonPart.replace(/\n/g, ' '); 
        
        scriptData = JSON.parse(jsonPart);
      } else {
        throw new Error("Incomplete JSON structure");
      }
    } catch (parseError) {
      console.error('Whiteboard JSON Parse Error. Raw Response:', aiResponse);
      
      // 4. Emergency Recovery: Manual extraction of partial steps
      const steps = [];
      const regex = /\{"title":\s*"([^"]+)",\s*"writing":\s*"([^"]+)",\s*"narration":\s*"([^"]+)"\}/g;
      let match;
      while ((match = regex.exec(aiResponse)) !== null) {
        steps.push({
          title: match[1],
          writing: match[2],
          narration: match[3]
        });
      }

      if (steps.length > 0) {
        scriptData = { steps };
      } else {
        throw new Error('AI failed to generate a valid whiteboard session. Please try again.');
      }
    }

    res.json(scriptData);
  } catch (error) {
    console.error('Whiteboard Engine Error:', error.message);
    res.status(500).json({ message: 'Error generating whiteboard script', error: error.message });
  }
};

module.exports = { generateWhiteboardTutorial };
