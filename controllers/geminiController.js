const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Using the exact model name you found: 'gemini-3.5-flash'
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Primary models to try in order of preference
const MODELS = [
  "gemini-1.5-flash", 
  "gemini-1.5-flash-latest",
  "gemini-1.5-pro", 
  "gemini-1.5-pro-latest",
  "gemini-1.0-pro",
  "gemini-pro"
];

const generateContent = async (prompt, feature = 'general') => {
  let lastError;
  for (const modelName of MODELS) {
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
      lastError = error;
      aiRequestCounter.labels(feature, modelName, 'error').inc();
      console.error(`Gemini Error (${modelName}):`, error.message);
      if (error.message.includes("429") || error.message.includes("404")) {
        continue;
      }
      continue;
    }
  }
  throw lastError || new Error("All Gemini models failed");
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  let lastError;
  for (const modelName of MODELS) {
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
      lastError = error;
      aiRequestCounter.labels(feature, modelName, 'error').inc();
      console.error(`Gemini Chat Error (${modelName}):`, error.message);
      continue;
    }
  }
  throw lastError || new Error("All Gemini models failed for chat");
};

const extractTextFromBuffer = async (buffer, mimeType) => {
  let lastError;
  // Flash is better for vision/extraction tasks
  const visionModels = ["gemini-1.5-flash", "gemini-1.5-pro"];
  for (const modelName of visionModels) {
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
      lastError = error;
      console.error(`Extraction error (${modelName}):`, error.message);
      continue;
    }
  }
  throw lastError || new Error("All Gemini models failed for extraction");
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
