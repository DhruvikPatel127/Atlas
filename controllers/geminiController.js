const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation
let genAIInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  // Support comma-separated keys: KEY1,KEY2,KEY3
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  genAIInstances = keys.map(key => new GoogleGenerativeAI(key));
  console.log(`Initialized AI Rotation with ${genAIInstances.length} API keys.`);
}

const getNextGenAI = () => {
  if (genAIInstances.length === 0) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  const instance = genAIInstances[currentKeyIndex];
  // Rotate index for next time
  currentKeyIndex = (currentKeyIndex + 1) % genAIInstances.length;
  return instance;
};

// Only use gemini-3.5-flash as requested by the user for perfect consistency.
const MODELS = [
  "gemini-3.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  try {
    console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
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
    console.error(`Gemini Error (Key #${currentKeyIndex}):`, error.message);
    
    // Auto-retry with NEXT KEY if rate limited or overloaded
    if ((error.message.includes("429") || error.message.includes("503") || error.message.includes("overloaded")) && attempt < genAIInstances.length + 1) {
      console.log(`Key #${currentKeyIndex} is busy. Rotating to next key...`);
      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      return generateContent(prompt, feature, attempt + 1);
    }

    aiRequestCounter.labels(feature, modelName, 'error').inc();
    throw new Error("AI is currently busy across all keys. Please wait a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  try {
    console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
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
    console.error(`Gemini Chat Error (Key #${currentKeyIndex}):`, error.message);
    
    // Auto-retry with NEXT KEY
    if ((error.message.includes("429") || error.message.includes("overloaded")) && attempt < genAIInstances.length + 1) {
      console.log(`Chat Key #${currentKeyIndex} is busy. Rotating...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return chatWithGemini(history, message, feature, attempt + 1);
    }

    aiRequestCounter.labels(feature, modelName, 'error').inc();
    throw new Error("Chat is temporarily unavailable. Please try again in a few seconds.");
  }
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1) => {
  const genAI = getNextGenAI();
  const modelName = MODELS[0];
  
  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex}...`);
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
