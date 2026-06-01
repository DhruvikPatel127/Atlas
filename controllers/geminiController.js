const { GoogleGenAI } = require("@google/genai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation using the new Google GenAI SDK
let aiInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  aiInstances = keys.map(key => new GoogleGenAI({ apiKey: key }));
  console.log(`Initialized AI Rotation with ${aiInstances.length} API keys using @google/genai SDK.`);
}

const getNextAI = () => {
  if (aiInstances.length === 0) return null;
  const instance = aiInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
  return instance;
};

// Using gemini-3.5-flash as requested by the user from AI Studio docs
const MODELS = [
  "gemini-3.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false) => {
  const ai = getNextAI();
  const modelName = MODELS[0];
  
  if (ai) {
    try {
      console.log(`Attempting generateContent (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          maxOutputTokens: 2048,
          temperature: forceJson ? 0.1 : 0.7,
          topP: 0.8,
          topK: 40,
          responseMimeType: forceJson ? "application/json" : "text/plain",
        }
      });
      
      const text = response.text;
      
      if (text) {
        aiRequestCounter.labels(feature, modelName, 'success').inc();
        return text;
      }
    } catch (error) {
      console.error(`Gemini Primary Error:`, error.message);
      
      // Retry logic for 503/429 errors if multiple keys are available
      if ((error.message.includes("503") || error.message.includes("429") || error.message.includes("overloaded")) && attempt < aiInstances.length) {
        console.log(`Retrying with next key in 2 seconds due to service unavailability...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return generateContent(prompt, feature, attempt + 1, forceJson);
      }
    }
  }

  throw new Error("Gemini AI is currently unavailable. Please check your API keys and quotas.");
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1) => {
  const ai = getNextAI();
  const modelName = MODELS[0];
  
  if (ai) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
      
      // Format history for the new SDK
      // The new SDK expects a specific format for contents
      const contents = [
        ...history.map(h => ({
          role: h.role === 'model' ? 'assistant' : h.role,
          parts: [{ text: h.parts[0].text }]
        })),
        { role: 'user', parts: [{ text: message }] }
      ];

      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
          maxOutputTokens: 1024,
          temperature: 0.9,
        }
      });
      
      const text = response.text;

      if (text) return text;
    } catch (error) {
      console.error(`Gemini Chat Primary Error:`, error.message);
      
      if ((error.message.includes("503") || error.message.includes("429") || error.message.includes("overloaded")) && attempt < aiInstances.length) {
        console.log(`Retrying chat with next key in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return chatWithGemini(history, message, feature, attempt + 1);
      }
    }
  }

  throw new Error("Chat AI is currently unavailable.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1) => {
  const ai = getNextAI();
  const modelName = MODELS[0];
  
  if (!ai) throw new Error("AI not initialized");

  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex} using ${modelName}...`);
    
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: "Extract all text from this file. It may contain student handwriting, diagrams, or printed text. If it is handwritten, do your best to transcribe it accurately. Maintain the logical structure (headings, bullet points). If there are diagrams or tables, provide a clear text description of what they represent. Return only the transcribed text." },
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
    console.error(`Extraction error (Key #${currentKeyIndex}):`, error.message);
    
    if ((error.message.includes("429") || error.message.includes("503") || error.message.includes("overloaded")) && attempt < aiInstances.length) {
      console.log(`Retrying extraction with next key in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
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
