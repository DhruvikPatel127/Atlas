const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation
let genAIInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  genAIInstances = keys.map(key => new GoogleGenerativeAI(key));
  console.log(`Initialized AI Rotation with ${genAIInstances.length} API keys.`);
}

const getNextGenAI = () => {
  if (genAIInstances.length === 0) return null;
  const instance = genAIInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % genAIInstances.length;
  return instance;
};

// Using gemini-3.5-flash as requested by the user
const MODELS = [
  "gemini-3.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  // 1. Try Primary Gemini (Google SDK)
  if (genAI) {
    try {
      console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: forceJson ? 0.1 : 0.7,
          topP: 0.8,
          topK: 40,
          responseMimeType: forceJson ? "application/json" : "text/plain",
        }
      });
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      if (text) {
        aiRequestCounter.labels(feature, modelName, 'success').inc();
        return text;
      }
    } catch (error) {
      console.error(`Gemini Primary Error:`, error.message);
      
      // Retry logic for 503/429 errors if multiple keys are available
      if ((error.message.includes("503") || error.message.includes("429")) && attempt < genAIInstances.length) {
        console.log(`Retrying with next key due to service unavailability...`);
        return generateContent(prompt, feature, attempt + 1, forceJson);
      }
    }
  }

  throw new Error("Gemini AI is currently unavailable. Please check your API keys and quotas.");
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  if (genAI) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
      const model = genAI.getGenerativeModel({ 
        model: modelName,
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

      if (text) return text;
    } catch (error) {
      console.error(`Gemini Chat Primary Error:`, error.message);
      
      // Retry logic for 503/429 errors if multiple keys are available
      if ((error.message.includes("503") || error.message.includes("429")) && attempt < genAIInstances.length) {
        console.log(`Retrying chat with next key due to service unavailability...`);
        return chatWithGemini(history, message, feature, attempt + 1);
      }
    }
  }

  throw new Error("Chat AI is currently unavailable.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([
      "Extract all text from this file. It may contain student handwriting, diagrams, or printed text. " +
      "If it is handwritten, do your best to transcribe it accurately. " +
      "Maintain the logical structure (headings, bullet points). " +
      "If there are diagrams or tables, provide a clear text description of what they represent. " +
      "Return only the transcribed text.",
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
    console.error(`Extraction error (Key #${currentKeyIndex}):`, error.message);
    
    if ((error.message.includes("429") || error.message.includes("overloaded")) && attempt < genAIInstances.length + 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return extractTextFromBuffer(buffer, mimeType, attempt + 1);
    }
    
    throw error;
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
