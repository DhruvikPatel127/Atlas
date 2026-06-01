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
    - writing: Exactly what you would draw or write on the whiteboard. This MUST include specific formulas, key terms, or a structured summary. DO NOT return "N/A". If there is no specific formula, write the core principle or a summary of the concept.
    - narration: A detailed, conversational, and insightful explanation. Start with 'Now, let's look at...' or 'To truly understand this, we need to...'. Use an encouraging teacher's tone.

    Notes: ${note.content}

    The response MUST be a single, valid JSON object:
    {"steps": [{"title": "Concept Foundation", "writing": "Main Formula/Rule or Key Concept Summary", "narration": "Deep explanation text"}]} `;

    const aiResponse = await generateContent(prompt, 'whiteboard_script', 1, true);
    
    let scriptData;
    try {
      // 1. Clean common AI noise
      let cleaned = aiResponse.replace(/```json|```/g, '').trim();
      
      // 2. Find the FIRST { and attempt to find the LAST }
      const start = cleaned.indexOf('{');
      let end = cleaned.lastIndexOf('}');
      
      if (start !== -1) {
        let jsonPart;
        if (end === -1 || end < start) {
          // If no closing brace is found, the AI response was likely truncated.
          // We'll attempt to close it manually to save what we can.
          console.warn('AI response appears truncated. Attempting to repair JSON.');
          jsonPart = cleaned.substring(start) + '\n    ]\n}'; 
          
          // Count open and close brackets to be safer
          const openBrackets = (jsonPart.match(/\{/g) || []).length;
          const closeBrackets = (jsonPart.match(/\}/g) || []).length;
          for (let i = 0; i < openBrackets - closeBrackets; i++) {
            jsonPart += '}';
          }
        } else {
          jsonPart = cleaned.substring(start, end + 1);
        }
        
        // 3. Robust Cleaning for unescaped characters
        // We only want to escape newlines that are INSIDE the JSON strings, 
        // not the ones that are part of the JSON structure.
        // A safer way is to remove actual newlines that would break JSON.parse
        jsonPart = jsonPart.replace(/[\r\n]+/g, ' '); 
        
        try {
          scriptData = JSON.parse(jsonPart);
        } catch (innerError) {
          // If JSON.parse fails, try to fix common issues like trailing commas or unescaped quotes
          console.log('Standard JSON.parse failed, attempting aggressive repair...');
          let repaired = jsonPart
            .replace(/,\s*([\]\}])/g, '$1') // Remove trailing commas
            .replace(/([^\\])"/g, '$1\\"') // Escape unescaped quotes (simplified)
            .replace(/\\"/g, '"'); // Unescape correctly escaped quotes
            
          scriptData = JSON.parse(repaired);
        }

        // 4. Sanitize the writing field to avoid "N/A"
        if (scriptData.steps) {
          scriptData.steps = scriptData.steps.map(step => ({
            ...step,
            writing: (step.writing && step.writing.toUpperCase() !== 'N/A') ? step.writing : "Key Study Concept"
          }));
        }
      } else {
        throw new Error("No JSON object found in AI response");
      }
    } catch (parseError) {
      console.error('Whiteboard JSON Parse Error. Raw Response:', aiResponse);
      
      // 5. Emergency Recovery: Manual extraction of steps using a more flexible regex
      const steps = [];
      // Regex to find objects with title, writing, and narration even in broken JSON
      const stepRegex = /\{\s*"title":\s*"([^"]+)"\s*,\s*"writing":\s*"([^"]+)"\s*,\s*"narration":\s*"([^"]+)"\s*\}/g;
      let match;
      while ((match = stepRegex.exec(aiResponse)) !== null) {
        steps.push({
          title: match[1],
          writing: match[2],
          narration: match[3]
        });
      }

      if (steps.length > 0) {
        scriptData = { steps };
      } else {
        // Last ditch effort: if we have a truncated first step, extract it manually
        const titleMatch = aiResponse.match(/"title":\s*"([^"]+)"/);
        const writingMatch = aiResponse.match(/"writing":\s*"([^"]+)"/);
        const narrationMatch = aiResponse.match(/"narration":\s*"([^"]+)"/);
        
        if (titleMatch && writingMatch) {
          scriptData = {
            steps: [{
              title: titleMatch[1],
              writing: writingMatch[1],
              narration: narrationMatch ? narrationMatch[1] : "Explaining the core concepts..."
            }]
          };
        } else {
          throw new Error('AI failed to generate a valid whiteboard session. Please try again.');
        }
      }
    }

    res.json(scriptData);
  } catch (error) {
    console.error('Whiteboard Engine Error:', error.message);
    res.status(500).json({ message: 'Error generating whiteboard script', error: error.message });
  }
};

module.exports = { generateWhiteboardTutorial };
