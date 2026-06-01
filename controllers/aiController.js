const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Initialize genAI only if key is available using the stable SDK
let genAI;
if (process.env.GEMINI_API_KEY) {
  const apiKey = process.env.GEMINI_API_KEY.trim().replace(/["']/g, '');
  genAI = new GoogleGenerativeAI(apiKey);
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const USE_OPENROUTER = process.env.USE_OPENROUTER === 'true';

// Fallback model chain
const MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

const generateContent = async (prompt, feature = 'general', modelIndex = 0) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting generateContent with ${currentModel} using @google/generative-ai...`);
    
    const model = genAI.getGenerativeModel({ 
      model: currentModel,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      }
    });
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    if (!text) throw new Error("Empty response from Gemini");
    
    aiRequestCounter.labels(feature, currentModel, 'success').inc();
    return text;
  } catch (error) {
    console.error(`Gemini Error (${currentModel}):`, error.message);
    
    // Fallback logic for high demand
    if ((error.message.includes("429") || error.message.includes("503") || error.message.includes("demand")) && modelIndex < MODELS.length - 1) {
      console.log(`Falling back to ${MODELS[modelIndex + 1]}...`);
      return generateContent(prompt, feature, modelIndex + 1);
    }
    throw new Error("AI is currently overloaded. Please try again in a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat', modelIndex = 0) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const currentModel = MODELS[modelIndex];
  try {
    console.log(`Attempting chat with ${currentModel} using @google/generative-ai...`);
    
    const model = genAI.getGenerativeModel({ 
      model: currentModel,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.9,
      }
    });
    
    const chat = model.startChat({ 
      history: history.slice(-10),
    });
    
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    if ((error.message.includes("429") || error.message.includes("503") || error.message.includes("demand")) && modelIndex < MODELS.length - 1) {
      return chatWithGemini(history, message, feature, modelIndex + 1);
    }
    throw new Error("Chat failed due to high demand.");
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
};
