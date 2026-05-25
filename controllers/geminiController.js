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

// Exhaustive list of models for reliable fallback
const MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-flash-latest",
  "gemini-3-flash-latest",
  "gemini-2.5-flash-latest",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-pro"
];

// Helper for exponential backoff sleep
const delay = (ms) => new Promise(res => setTimeout(ms, res));

const generateContent = async (prompt, feature = 'general') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  let lastError;
  
  // Try each model in the list
  for (const modelName of MODELS) {
    let retries = 2;
    while (retries > 0) {
      try {
        console.log(`Attempting generateContent with ${modelName}... (Retries left: ${retries})`);
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
        lastError = error;
        aiRequestCounter.labels(feature, modelName, 'error').inc();
        console.error(`Gemini Error (${modelName}):`, error.message);
        
        // If Rate Limit (429), retry with delay or switch model
        if (error.message.includes("429")) {
          retries--;
          if (retries > 0) {
            console.log(`Rate limited on ${modelName}. Waiting 2s before retry...`);
            await delay(2000);
            continue;
          }
          console.log(`Rate limit exhausted for ${modelName}. Switching to next model...`);
          break; // Move to next model in the MODELS list
        }
        
        // If 404 (Model not found) or other non-retryable, switch model immediately
        break; 
      }
    }
  }
  
  const errorMessage = lastError?.message || "AI generation failed";
  if (errorMessage.includes("429")) {
    throw new Error("AI is currently overloaded across all available models. Please wait about 30 seconds and try again.");
  }
  throw new Error(`AI generation failed after multiple attempts: ${errorMessage}`);
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  let lastError;

  for (const modelName of MODELS) {
    let retries = 1; // Less retries for chat to keep it snappy
    while (retries >= 0) {
      try {
        console.log(`Attempting chat with ${modelName}...`);
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

        if (!text) throw new Error("Empty response from Gemini Chat");
        
        aiRequestCounter.labels(feature, modelName, 'success').inc();
        const tokenCount = Math.ceil((message.length + text.length) / 4);
        aiTokensUsed.labels(feature, 'total').inc(tokenCount);
        
        return text;
      } catch (error) {
        lastError = error;
        aiRequestCounter.labels(feature, modelName, 'error').inc();
        console.error(`Gemini Chat Error (${modelName}):`, error.message);
        
        if (error.message.includes("429")) {
          retries--;
          if (retries >= 0) {
            await delay(1500);
            continue;
          }
          break; // Switch model
        }
        break; 
      }
    }
  }
  
  throw new Error("Chat failed across all models. Please wait a moment and try again.");
};

const extractTextFromBuffer = async (buffer, mimeType) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  let lastError;
  // OCR is critical, try multiple models
  for (const modelName of MODELS) {
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
      if (error.message.includes("429")) {
        await delay(2000);
      }
      continue;
    }
  }
  throw new Error("File extraction failed across all models. Please check your internet or try a different file.");
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
