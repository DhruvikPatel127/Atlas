const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Initialize genAI only if key is available
let genAI;
if (process.env.GEMINI_API_KEY) {
  const apiKey = process.env.GEMINI_API_KEY.trim().replace(/["']/g, '');
  genAI = new GoogleGenerativeAI(apiKey);
}

// Only use gemini-3.5-flash as requested by the user for perfect consistency.
const MODELS = [
  "gemini-3.5-flash"
];

const generateContent = async (prompt, feature = 'general') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS[0];
  try {
    console.log(`Attempting generateContent with ${modelName}...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Track success
    aiRequestCounter.labels(feature, modelName, 'success').inc();
    // Estimate tokens (roughly 4 chars per token)
    const tokenCount = Math.ceil((prompt.length + response.text().length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);
    
    return response.text();
  } catch (error) {
    aiRequestCounter.labels(feature, modelName, 'error').inc();
    console.error(`Gemini Error (${modelName}):`, error.message);
    
    if (error.message.includes("404")) {
      throw new Error(`Gemini API Error: Model ${modelName} not found. Please ensure the "Generative Language API" is enabled and this model is available in your region.`);
    }
    throw error;
  }
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS[0];
  try {
    console.log(`Attempting chat with ${modelName}...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    
    aiRequestCounter.labels(feature, modelName, 'success').inc();
    const tokenCount = Math.ceil((message.length + response.text().length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);
    
    return response.text();
  } catch (error) {
    aiRequestCounter.labels(feature, modelName, 'error').inc();
    console.error(`Gemini Chat Error (${modelName}):`, error.message);
    
    if (error.message.includes("404")) {
      throw new Error(`Gemini API Error: Model ${modelName} not found in Chat. Please check your Google Cloud Project settings.`);
    }
    throw error;
  }
};

const extractTextFromBuffer = async (buffer, mimeType) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS[0];
  try {
    console.log(`Attempting extraction with ${modelName}...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([
      "Extract all the text from this file and return it as a plain text string. If there are tables or diagrams, describe them simply.",
      {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: mimeType,
        },
      },
    ]);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error(`Extraction error (${modelName}):`, error.message);
    
    if (error.message.includes("404")) {
      throw new Error(`Gemini API Error: Model ${modelName} not found in Extraction. Please check your Google Cloud Project settings.`);
    }
    throw error;
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
