const dotenv = require('dotenv');
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

// Helper to clean API keys from potential quotes or spaces
const cleanKey = (key) => key ? key.trim().replace(/["']/g, '') : null;

// Initialize genAI only if key is available
let genAI;
const GEMINI_API_KEY = cleanKey(process.env.GEMINI_API_KEY);
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

const OPENROUTER_API_KEY = cleanKey(process.env.OPENROUTER_API_KEY);
const USE_OPENROUTER = process.env.USE_OPENROUTER === 'true';

if (USE_OPENROUTER) {
  if (!OPENROUTER_API_KEY) {
    console.warn("⚠️ USE_OPENROUTER is true but OPENROUTER_API_KEY is missing!");
  } else {
    console.log(`✅ OpenRouter initialized with key: ${OPENROUTER_API_KEY.substring(0, 8)}...${OPENROUTER_API_KEY.slice(-4)}`);
  }
}

// Only use gemini-1.5-flash for Gemini, or appropriate model for OpenRouter
const MODELS = {
  gemini: "gemini-1.5-flash",
  openrouter: process.env.OPENROUTER_MODEL || "google/gemini-flash-1.5"
};

const generateWithOpenRouter = async (prompt, feature) => {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: MODELS.openrouter,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
          "X-Title": "Atlas AI",
        },
      }
    );

    const text = response.data.choices[0].message.content;
    
    // Track success
    aiRequestCounter.labels(feature, MODELS.openrouter, 'success').inc();
    const tokenCount = Math.ceil((prompt.length + text.length) / 4);
    aiTokensUsed.labels(feature, 'total').inc(tokenCount);

    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, MODELS.openrouter, 'error').inc();
    console.error(`OpenRouter Error:`, error.response?.data || error.message);
    throw new Error("AI generation via OpenRouter failed.");
  }
};

const generateContent = async (prompt, feature = 'general') => {
  if (USE_OPENROUTER && OPENROUTER_API_KEY) {
    try {
      return await generateWithOpenRouter(prompt, feature);
    } catch (error) {
      console.warn("OpenRouter failed, falling back to Gemini:", error.message);
      // Fall through to Gemini logic
    }
  }

  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS.gemini;
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
    throw new Error("AI generation failed. Please try a shorter prompt or wait a moment.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat') => {
  if (USE_OPENROUTER && OPENROUTER_API_KEY) {
    // OpenRouter chat implementation
    try {
      const formattedHistory = history.map(h => ({
        role: h.role === 'model' ? 'assistant' : h.role,
        content: h.parts[0].text
      }));
      formattedHistory.push({ role: 'user', content: message });

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: MODELS.openrouter,
          messages: formattedHistory,
        },
        {
          headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
            "X-Title": "Atlas AI",
          },
        }
      );

      const text = response.data.choices[0].message.content;
      return text;
    } catch (error) {
      console.warn("OpenRouter Chat failed, falling back to Gemini:", error.message);
      // Fall through to Gemini logic
    }
  }

  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS.gemini;
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
    return text;
  } catch (error) {
    aiRequestCounter.labels(feature, modelName, 'error').inc();
    console.error(`Gemini Chat Error (${modelName}):`, error.message);
    throw new Error("Chat failed. Try refreshing the chat.");
  }
};

module.exports = {
  generateContent,
  chatWithGemini,
};
