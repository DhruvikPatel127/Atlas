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

// Use the exact model name from your documentation
const PRIMARY_MODEL = "gemini-3.5-flash";

const generateContent = async (prompt, feature = 'general') => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  try {
    console.log(`Attempting generateContent with ${PRIMARY_MODEL} using @google/genai...`);
    
    // Use the exact syntax from your AI Studio screenshot
    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: 2048,
        temperature: 0.7,
      }
    });
    
    const text = response.text;
    
    if (!text) throw new Error("Empty response from Gemini");
    
    // Track success
    aiRequestCounter.labels(feature, PRIMARY_MODEL, 'success').inc();
    const tokenCount = Math.ceil((prompt.length + text.length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);
    
    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, PRIMARY_MODEL, 'error').inc();
    console.error(`Gemini Error (${PRIMARY_MODEL}):`, error.message);
    
    if (error.message.includes("429") || error.message.includes("503") || error.message.includes("demand")) {
      throw new Error("AI is currently overloaded due to high demand. Please wait a few seconds and try again.");
    }
    throw new Error("AI generation failed. Please try again in a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  try {
    console.log(`Attempting chat with ${PRIMARY_MODEL} using @google/genai...`);
    
    const contents = [
      ...history.map(h => ({
        role: h.role === 'model' ? 'assistant' : h.role,
        parts: [{ text: h.parts[0].text }]
      })),
      { role: 'user', parts: [{ text: message }] }
    ];

    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: 1024,
        temperature: 0.9,
      }
    });
    
    const text = response.text;

    if (!text) throw new Error("Empty response from Gemini Chat");
    
    aiRequestCounter.labels(feature, PRIMARY_MODEL, 'success').inc();
    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, PRIMARY_MODEL, 'error').inc();
    console.error(`Gemini Chat Error (${PRIMARY_MODEL}):`, error.message);
    throw new Error("Chat failed due to high demand. Try again in a moment.");
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
};
