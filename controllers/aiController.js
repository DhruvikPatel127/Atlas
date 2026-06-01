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

// Fallback model chain with v1beta compatible IDs
const MODELS = [
  "gemini-3.5-flash",
  "gemini-1.5-flash-latest"
];

const generateContent = async (prompt, feature = 'general', modelIndex = 0) => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting generateContent with ${currentModel} using @google/genai...`);
    
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
    console.error(`Gemini Error (${currentModel}):`, error.message);
    
    // Fallback logic for high demand or 404
    if (modelIndex < MODELS.length - 1) {
      console.log(`Falling back to ${MODELS[modelIndex + 1]}...`);
      return generateContent(prompt, feature, modelIndex + 1);
    }
    throw new Error("AI is currently overloaded. Please try again in a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat', modelIndex = 0) => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting chat with ${currentModel} using @google/genai...`);
    
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
    if (modelIndex < MODELS.length - 1) {
      return chatWithGemini(history, message, feature, modelIndex + 1);
    }
    throw new Error("Chat failed due to high demand.");
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
};
