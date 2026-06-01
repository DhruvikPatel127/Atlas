const { GoogleGenAI } = require("@google/genai");
const axios = require('axios');
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Initialize genAI only if key is available using the NEW @google/genai SDK
let ai;
if (process.env.GEMINI_API_KEY) {
  const apiKey = process.env.GEMINI_API_KEY.trim().replace(/["']/g, '');
  ai = new GoogleGenAI({ apiKey: apiKey });
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const USE_OPENROUTER = process.env.USE_OPENROUTER === 'true';

// Comprehensive fallback model chain
const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

const generateContent = async (prompt, feature = 'general', modelIndex = 0, attempt = 1) => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting generateContent with ${currentModel} (Attempt ${attempt}) using @google/genai...`);
    
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: prompt,
      config: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      }
    });
    
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    
    aiRequestCounter.labels(feature, currentModel, 'success').inc();
    return text;
  } catch (error) {
    const errorMsg = error.message || JSON.stringify(error);
    console.error(`Gemini Error (${currentModel}):`, errorMsg);
    
    // 1. Retry with same model if it's a transient error
    if ((errorMsg.includes("429") || errorMsg.includes("503") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < 3) {
      const delay = (attempt * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return generateContent(prompt, feature, modelIndex, attempt + 1);
    }

    // 2. Fallback to next model
    if (modelIndex < MODELS.length - 1) {
      console.log(`Model ${currentModel} failed. Falling back to ${MODELS[modelIndex + 1]}...`);
      return generateContent(prompt, feature, modelIndex + 1, 1);
    }
    throw new Error("AI is currently overloaded across all models. Please wait a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat', modelIndex = 0, attempt = 1) => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting chat with ${currentModel} (Attempt ${attempt}) using @google/genai...`);
    
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
    return text;
  } catch (error) {
    const errorMsg = error.message || JSON.stringify(error);
    if ((errorMsg.includes("429") || errorMsg.includes("503") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < 3) {
      const delay = (attempt * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return chatWithGemini(history, message, feature, modelIndex, attempt + 1);
    }

    if (modelIndex < MODELS.length - 1) {
      return chatWithGemini(history, message, feature, modelIndex + 1, 1);
    }
    throw new Error("Chat failed due to high demand.");
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
};
