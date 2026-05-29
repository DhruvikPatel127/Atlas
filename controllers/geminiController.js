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

// Only use gemini-3.5-flash as requested by the user for perfect consistency.
const MODELS = [
  "gemini-3.5-flash"
];

const callOpenRouter = async (prompt, modelName, forceJson) => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  
  try {
    console.log('Attempting fallback: OpenRouter...');
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'google/gemini-2.0-flash-001', // Map to a real Gemini model on OpenRouter
      messages: [{ role: 'user', content: prompt }],
      response_format: forceJson ? { type: 'json_object' } : undefined,
      temperature: forceJson ? 0.1 : 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('OpenRouter Fallback Failed:', err.message);
    return null;
  }
};

const callDeepSeek = async (prompt, forceJson) => {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  
  try {
    console.log('Attempting fallback: DeepSeek...');
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: forceJson ? { type: 'json_object' } : undefined,
      temperature: forceJson ? 0.1 : 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content;
  } catch (err) {
    console.error('DeepSeek Fallback Failed:', err.message);
    return null;
  }
};

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
    }
  }

  // 2. Fallback to OpenRouter
  const orResponse = await callOpenRouter(prompt, modelName, forceJson);
  if (orResponse) return orResponse;

  // 3. Fallback to DeepSeek
  const dsResponse = await callDeepSeek(prompt, forceJson);
  if (dsResponse) return dsResponse;

  throw new Error("All AI providers failed. Please check your API keys and quotas.");
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
    }
  }

  // Simple prompt for fallbacks in chat mode
  const prompt = `History:\n${history.map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}\nUser: ${message}`;
  
  const orResponse = await callOpenRouter(prompt, modelName, false);
  if (orResponse) return orResponse;

  const dsResponse = await callDeepSeek(prompt, false);
  if (dsResponse) return dsResponse;

  throw new Error("Chat AI is currently unavailable across all providers.");
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
