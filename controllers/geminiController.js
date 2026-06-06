const { GoogleGenAI } = require("@google/genai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation using the NEW @google/genai SDK
let aiInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  // Use the new SDK initialization from documentation
  aiInstances = keys.map(key => new GoogleGenAI({ apiKey: key }));
  console.log(`Initialized AI Rotation with ${aiInstances.length} API keys using @google/genai SDK.`);
}

const getNextAI = () => {
  if (aiInstances.length === 0) return null;
  const instance = aiInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
  return instance;
};

// Comprehensive fallback chain for maximum reliability
const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (ai) {
    try {
      console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex} using ${currentModel}...`);
      
      const response = await ai.models.generateContent({
        model: currentModel,
        contents: prompt,
        config: {
          maxOutputTokens: feature === 'whiteboard_script' ? 4096 : 2048,
          temperature: forceJson ? 0.1 : 0.7,
          responseMimeType: forceJson ? "application/json" : "text/plain",
        }
      });
      
      const text = response.text;
      
      if (text) {
        aiRequestCounter.labels(feature, currentModel, 'success').inc();
        return text;
      }
    } catch (error) {
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Error (${currentModel}):`, errorMsg);
      
      // 1. If high demand/rate limit/404, rotate keys for the SAME model (up to 2 rounds)
      if ((errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < (aiInstances.length * 2)) {
        // Longer backoff for "High Demand": 3s, 6s, 9s...
        const delay = (attempt * 2000) + 1000;
        console.log(`Issue with ${currentModel}. Retrying with next key in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return generateContent(prompt, feature, attempt + 1, forceJson, modelIndex);
      }
      
      // 2. If keys are exhausted or fatal error for this model, try NEXT MODEL in chain
      if (modelIndex < MODELS.length - 1) {
        console.log(`${currentModel} failed completely. Falling back to ${MODELS[modelIndex + 1]}...`);
        return generateContent(prompt, feature, 1, forceJson, modelIndex + 1);
      }
    }
  }

  throw new Error(`All Gemini models are currently overloaded. Please try again in 5 minutes.`);
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (ai) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex} using ${currentModel}...`);
      
      const contents = [
        ...history.map(h => ({
          role: h.role === 'model' ? 'assistant' : h.role,
          parts: [{ text: h.parts[0].text }]
        })),
        { role: 'user', parts: [{ text: message }] }
      ];

      const response = await ai.models.generateContent({
        model: currentModel,
        contents: contents,
        config: {
          maxOutputTokens: 1024,
          temperature: 0.9,
        }
      });
      
      const text = response.text;

      if (text) return text;
    } catch (error) {
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Chat Error (${currentModel}):`, errorMsg);
      
      if ((errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < (aiInstances.length * 2)) {
        const delay = (attempt * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return chatWithGemini(history, message, feature, attempt + 1, modelIndex);
      }

      if (modelIndex < MODELS.length - 1) {
        return chatWithGemini(history, message, feature, 1, modelIndex + 1);
      }
    }
  }

  throw new Error("Chat is temporarily unavailable.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (!ai) throw new Error("AI not initialized");

  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex} using ${currentModel}...`);
    
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: [
        {
          parts: [
            { text: "Extract all text from this file. Return only the transcribed text." },
            {
              inlineData: {
                data: buffer.toString("base64"),
                mimeType: mimeType,
              }
            }
          ]
        }
      ]
    });
    
    return response.text;
  } catch (error) {
    const errorMsg = error.message || JSON.stringify(error);
    console.error(`Extraction error (${currentModel}):`, errorMsg);
    
    if ((errorMsg.includes("429") || errorMsg.includes("503") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < (aiInstances.length * 2)) {
      const delay = (attempt * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractTextFromBuffer(buffer, mimeType, attempt + 1, modelIndex);
    }

    if (modelIndex < MODELS.length - 1) {
      return extractTextFromBuffer(buffer, mimeType, 1, modelIndex + 1);
    }
    
    throw error;
  }
};

/**
 * Robustly parses AI responses into JSON objects.
 * Handles markdown wrapping, extra text, and basic truncation.
 */
const safeParseAIResponse = (text) => {
  if (!text) return null;
  
  let cleaned = text.trim();
  
  // 1. Remove markdown code blocks if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }
  
  cleaned = cleaned.trim();

  // 2. Try to find the first '{' and last '}'
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  } else if (start !== -1 && end === -1) {
    // Truncated response - missing closing bracket
    // Basic repair: append a closing bracket
    cleaned = cleaned.substring(start) + '}';
    // We could do more complex repair here, but usually, a simple append 
    // helps JSON.parse get as far as it can.
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Initial JSON Parse Failed. Attempting aggressive repair...', e.message);
    
    // Aggressive repair for truncated JSON
    try {
      // Fix missing closing brackets for nested structures
      let openBraces = (cleaned.match(/\{/g) || []).length;
      let closeBraces = (cleaned.match(/\}/g) || []).length;
      while (closeBraces < openBraces) {
        cleaned += '}';
        closeBraces++;
      }
      
      let openBrackets = (cleaned.match(/\[/g) || []).length;
      let closeBrackets = (cleaned.match(/\]/g) || []).length;
      while (closeBrackets < openBrackets) {
        cleaned += ']';
        closeBrackets++;
      }
      
      return JSON.parse(cleaned);
    } catch (innerError) {
      console.error('Aggressive Repair Failed:', innerError.message);
      return null;
    }
  }
};

module.exports = { 
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
  safeParseAIResponse
};
