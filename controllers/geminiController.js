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
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      }
    });
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    if (!text) throw new Error("Empty response from Gemini");
    
    // Track success
    aiRequestCounter.labels(feature, modelName, 'success').inc();
    const tokenCount = Math.ceil((prompt.length + text.length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);
    
    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, modelName, 'error').inc();
    console.error(`Gemini Error (${modelName}):`, error.message);
    
    if (error.message.includes("429")) {
      throw new Error("AI is currently overloaded. Please wait a few seconds and try again.");
    }
    if (error.message.includes("404")) {
      throw new Error(`Gemini API Error: Model ${modelName} not found.`);
    }
    throw new Error("AI generation failed. Please try a shorter prompt or wait a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS[0];
  try {
    console.log(`Attempting chat with ${modelName}...`);
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.9, // More creative for chat
      }
    });
    
    const chat = model.startChat({ 
      history: history.slice(-10), // Only send last 10 messages to keep it fast
    });
    
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    if (!text) throw new Error("Empty response from Gemini Chat");
    
    aiRequestCounter.labels(feature, modelName, 'success').inc();
    const tokenCount = Math.ceil((message.length + text.length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);
    
    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, modelName, 'error').inc();
    console.error(`Gemini Chat Error (${modelName}):`, error.message);
    
    if (error.message.includes("429")) {
      throw new Error("Chat is busy. Please wait a moment.");
    }
    throw new Error("Chat failed. Try refreshing the chat.");
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
