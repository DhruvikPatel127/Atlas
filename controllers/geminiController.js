const { GoogleGenAI } = require("@google/genai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation using the NEW @google/genai SDK
let aiInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  // Initialize according to the new SDK: new GoogleGenAI({ apiKey: "..." })
  aiInstances = keys.map(key => new GoogleGenAI({ apiKey: key }));
  console.log(`Initialized AI Rotation with ${aiInstances.length} API keys using @google/genai SDK.`);
}

const getNextAI = () => {
  if (aiInstances.length === 0) return null;
  const instance = aiInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
  return instance;
};

// Use the exact model name from your documentation
const PRIMARY_MODEL = "gemini-3.5-flash";

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false) => {
  const ai = getNextAI();
  
  if (ai) {
    try {
      console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex} using ${PRIMARY_MODEL}...`);
      
      // Use the exact syntax from your AI Studio screenshot
      const response = await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: prompt,
        config: {
          maxOutputTokens: feature === 'whiteboard_script' ? 4096 : 2048,
          temperature: forceJson ? 0.1 : 0.7,
          responseMimeType: forceJson ? "application/json" : "text/plain",
        }
      });
      
      const text = response.text;
      
      if (text) {
        aiRequestCounter.labels(feature, PRIMARY_MODEL, 'success').inc();
        return text;
      }
    } catch (error) {
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Error (${PRIMARY_MODEL}):`, errorMsg);
      
      // Retry logic for 503 (High Demand) or 429 (Rate Limit)
      if ((errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("demand")) && attempt < aiInstances.length) {
        // Longer backoff for "High Demand" spikes: 3s, 6s, 12s...
        const delay = Math.pow(2, attempt) * 1500 + 1500;
        console.log(`Model is in high demand. Retrying with next key in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return generateContent(prompt, feature, attempt + 1, forceJson);
      }
    }
  }

  throw new Error(`Gemini AI (${PRIMARY_MODEL}) is currently experiencing very high demand across all your keys. Please try again in a few moments.`);
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1) => {
  const ai = getNextAI();
  
  if (ai) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex} using ${PRIMARY_MODEL}...`);
      
      // Format history for the new SDK structure
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

      if (text) return text;
    } catch (error) {
      const errorMsg = error.message || JSON.stringify(error);
      console.error(`Gemini Chat Error (${PRIMARY_MODEL}):`, errorMsg);
      
      if ((errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("demand")) && attempt < aiInstances.length) {
        const delay = Math.pow(2, attempt) * 1500 + 1500;
        console.log(`Retrying chat with next key in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return chatWithGemini(history, message, feature, attempt + 1);
      }
    }
  }

  throw new Error("Chat AI is currently unavailable due to high demand.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1) => {
  const ai = getNextAI();
  
  if (!ai) throw new Error("AI not initialized");

  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex} using ${PRIMARY_MODEL}...`);
    
    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: [
        {
          parts: [
            { text: "Extract all text from this file. Return only the transcribed text." },
            {
              inlineData: {
                data: buffer.toString("base64"),
                mimeType: mimeType,
              }
            }
          ]
        }
      ]
    });
    
    return response.text;
  } catch (error) {
    const errorMsg = error.message || JSON.stringify(error);
    console.error(`Extraction error (${PRIMARY_MODEL}):`, errorMsg);
    
    if ((errorMsg.includes("429") || errorMsg.includes("503") || errorMsg.includes("demand")) && attempt < aiInstances.length) {
      const delay = Math.pow(2, attempt) * 1500 + 1500;
      console.log(`Retrying extraction with next key in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
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
