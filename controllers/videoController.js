const axios = require('axios');
const Note = require('../models/Note');
const { generateContent, safeParseAIResponse } = require('./geminiController');

const generateWhiteboardTutorial = async (req, res) => {
  try {
    const { noteId } = req.body;
    const userId = req.user.id || req.user._id;

    const note = await Note.findOne({ _id: noteId, userId: userId });
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const prompt = `Act as an expert teacher conducting a deep-dive classroom session. 
    Explain the following notes in a way that ensures the student develops a deep understanding, not just memorization.
    
    Structure the tutorial into 3-4 comprehensive steps. For each step:
    - title: A short, professional heading.
    - writing: Exactly what you would draw or write on the whiteboard. This MUST include specific formulas, key terms, or a structured summary.
    - narration: A detailed, conversational, and insightful explanation.

    Notes: ${note.content.substring(0, 4000)}

    The response MUST be a single, valid JSON object:
    {"steps": [{"title": "Step Title", "writing": "Formula/Concept", "narration": "Explanation"}]} `;

    let scriptData;
    try {
      const aiResponse = await generateContent(prompt, 'whiteboard_script', 1, true);
      scriptData = safeParseAIResponse(aiResponse);
    } catch (aiError) {
      console.error('Whiteboard AI failed, using fallback:', aiError.message);
    }

    // GUARANTEED SUCCESS: Safe Fallback for Whiteboard
    if (!scriptData || !scriptData.steps || !Array.isArray(scriptData.steps) || scriptData.steps.length === 0) {
      console.log('Using improved fallback whiteboard for note:', note.title);
      
      // Extract first 100 characters of content to make the fallback "real"
      const previewText = note.content.substring(0, 150).replace(/[\r\n]/g, ' ') + "...";
      
      scriptData = {
        steps: [
          {
            title: "Understanding " + (note.title.length > 20 ? note.subject : note.title),
            writing: "Topic: " + (note.subject || "General Study"),
            narration: "Hello! Today we are diving into your notes. Based on the material you uploaded, we will focus on the most important concepts and how they relate to " + (note.subject || "this subject") + "."
          },
          {
            title: "Core Content Analysis",
            writing: "Summary:\n" + (note.content.length > 10 ? note.content.substring(0, 80) + "..." : "Key Principles"),
            narration: "Looking at your notes, the primary focus is: " + previewText + " Let's break this down into clear, understandable parts."
          },
          {
            title: "Key Takeaways",
            writing: "1. Review Core Terms\n2. Practice Application\n3. Master Concepts",
            narration: "To master this topic, I recommend reviewing the key terms we just discussed and then trying a quick quiz to test your memory. You're doing great!"
          }
        ]
      };
    }

    // Final sanitization
    scriptData.steps = scriptData.steps.map(step => ({
      title: step.title || "Learning Step",
      writing: (step.writing && step.writing.toUpperCase() !== 'N/A') ? step.writing : "Key Concept",
      narration: step.narration || "Let's examine this concept in detail..."
    }));

    res.json(scriptData);
  } catch (error) {
    console.error('Whiteboard Engine Error:', error.message);
    res.status(500).json({ message: 'Error generating whiteboard script', error: error.message });
  }
};

module.exports = { generateWhiteboardTutorial };
