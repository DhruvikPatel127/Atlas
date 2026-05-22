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

// Primary models to try in order of preference
// Note: gemini-pro and gemini-1.0-pro were deprecated/replaced by 2026.
// Using Gemini 2.5 and 3.0 series which are standard now.
const MODELS = [
  "gemini-3.1-flash-latest",
  "gemini-3.1-pro-latest",
  "gemini-3-flash-latest",
  "gemini-3-pro-latest",
  "gemini-2.5-flash-latest",
  "gemini-2.5-pro-latest",
  "gemini-1.5-flash", 
  "gemini-1.5-pro"
];

const generateContent = async (prompt, feature = 'general') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  // Debug: List models if we keep getting 404 (only once per app start)
  if (!global.modelsListed) {
    try {
      console.log("--- Debug: Listing Available Models ---");
      // The SDK might not have listModels in all versions, but let's try
      // result = await genAI.listModels(); 
      // console.log(result);
      global.modelsListed = true;
    } catch (e) {
      console.log("Could not list models:", e.message);
    }
  }

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
  const errorMessage = lastError?.message || "All Gemini models failed";
  if (errorMessage.includes("404")) {
    throw new Error(`Gemini API Error: Models not found. This usually means your API Key is valid but the "Generative Language API" is not enabled in your Google Cloud Project, or the models are not available in your region. Please visit https://aistudio.google.com/ and check your API key settings.`);
  }
  throw lastError || new Error(errorMessage);
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
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
  const errorMessage = lastError?.message || "All Gemini models failed for chat";
  if (errorMessage.includes("404")) {
    throw new Error(`Gemini API Error: Models not found in Chat. Please check if "Generative Language API" is enabled in your Google Cloud Project.`);
  }
  throw lastError || new Error(errorMessage);
};

const extractTextFromBuffer = async (buffer, mimeType) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  let lastError;
  // Use latest Flash models for extraction as they are faster and cheaper
  const visionModels = [
    "gemini-3.1-flash-latest",
    "gemini-3-flash-latest",
    "gemini-2.5-flash-latest",
    "gemini-1.5-flash"
  ];
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
  const errorMessage = lastError?.message || "All Gemini models failed for extraction";
  if (errorMessage.includes("404")) {
    throw new Error(`Gemini API Error: Models not found in Extraction. Please check if "Generative Language API" is enabled in your Google Cloud Project.`);
  }
  throw lastError || new Error(errorMessage);
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
