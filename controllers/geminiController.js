const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation
let aiInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  aiInstances = keys.map(key => new GoogleGenerativeAI(key));
  console.log(`Initialized AI Rotation with ${aiInstances.length} API keys using @google/generative-ai SDK.`);
}

const getNextAI = () => {
  if (aiInstances.length === 0) return null;
  const instance = aiInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
  return instance;
};

// Model list for fallback - Using officially supported model names for @google/generative-ai
const MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false, modelIndex = 0) => {
  const genAI = getNextAI();
  const modelName = MODELS[modelIndex];
  
  if (genAI) {
    try {
      console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
      
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          maxOutputTokens: feature === 'whiteboard_script' ? 4096 : 2048,
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
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Primary Error (${modelName}):`, errorMsg);
      
      // 1. Try next key with SAME model
      if (attempt < aiInstances.length) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying with next key in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return generateContent(prompt, feature, attempt + 1, forceJson, modelIndex);
      } 
      
      // 2. If all keys failed for current model, try next model in list
      if (modelIndex < MODELS.length - 1) {
        console.log(`All keys failed for ${modelName}. Falling back to ${MODELS[modelIndex + 1]}...`);
        return generateContent(prompt, feature, 1, forceJson, modelIndex + 1);
      }
    }
  }

  throw new Error(`Gemini AI is currently unavailable after trying ${MODELS.length} models and ${aiInstances.length} keys.`);
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1, modelIndex = 0) => {
  const genAI = getNextAI();
  const modelName = MODELS[modelIndex];
  
  if (genAI) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
      
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
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Chat Primary Error (${modelName}):`, errorMsg);
      
      if (attempt < aiInstances.length) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying chat with next key in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return chatWithGemini(history, message, feature, attempt + 1, modelIndex);
      }

      if (modelIndex < MODELS.length - 1) {
        console.log(`Chat failed for ${modelName}. Falling back to ${MODELS[modelIndex + 1]}...`);
        return chatWithGemini(history, message, feature, 1, modelIndex + 1);
      }
    }
  }

  throw new Error("Chat AI is currently unavailable.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1, modelIndex = 0) => {
  const genAI = getNextAI();
  const modelName = MODELS[modelIndex];
  
  if (!genAI) throw new Error("AI not initialized");

  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
    
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent([
      {
        text: "Extract all text from this file. It may contain student handwriting, diagrams, or printed text. If it is handwritten, do your best to transcribe it accurately. Maintain the logical structure (headings, bullet points). If there are diagrams or tables, provide a clear text description of what they represent. Return only the transcribed text."
      },
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
    const errorMsg = error.message || JSON.stringify(error);
    console.error(`Extraction error (${modelName}):`, errorMsg);
    
    if (attempt < aiInstances.length) {
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying extraction with next key in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractTextFromBuffer(buffer, mimeType, attempt + 1, modelIndex);
    }

    if (modelIndex < MODELS.length - 1) {
      console.log(`Extraction failed for ${modelName}. Falling back to ${MODELS[modelIndex + 1]}...`);
      return extractTextFromBuffer(buffer, mimeType, 1, modelIndex + 1);
    }
    
    throw error;
  }
};

module.exports = { 
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
