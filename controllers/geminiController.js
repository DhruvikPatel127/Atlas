const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Provider Config
const PROVIDERS = {
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
  DEEPSEEK: 'deepseek'
};

// Support multiple API keys for rotation
let genAIInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  const keys = process.env.GEMINI_API_KEY.split(',').map(k => k.trim().replace(/["']/g, ''));
  genAIInstances = keys.map(key => new GoogleGenerativeAI(key));
  console.log(`Initialized Gemini Rotation with ${genAIInstances.length} API keys.`);
}

const getNextGenAI = () => {
  if (genAIInstances.length === 0) return null;
  const instance = genAIInstances[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % genAIInstances.length;
  return instance;
};

// Fallback Provider: OpenRouter
const callOpenRouter = async (prompt, isChat = false, history = []) => {
  if (!process.env.OPENROUTER_API_KEY) return null;
  
  try {
    console.log('Attempting Fallback: OpenRouter...');
    const messages = isChat 
      ? [...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.parts[0].text })), { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: "google/gemini-2.0-flash-exp:free", // Best free model on OpenRouter
      messages: messages,
      header: {
        "HTTP-Referer": "https://atlas-app.com",
        "X-Title": "Atlas AI"
      }
    }, {
      headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('OpenRouter Fallback Error:', error.message);
    return null;
  }
};

// Fallback Provider: DeepSeek
const callDeepSeek = async (prompt, isChat = false, history = []) => {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  try {
    console.log('Attempting Fallback: DeepSeek...');
    const messages = isChat 
      ? [...history.map(h => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.parts[0].text })), { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: messages,
    }, {
      headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('DeepSeek Fallback Error:', error.message);
    return null;
  }
};

const generateContent = async (prompt, feature = 'general', attempt = 1) => {
  const genAI = getNextGenAI();
  
  // 1. Try Gemini
  if (genAI && attempt <= genAIInstances.length) {
    try {
      console.log(`Gemini Attempt ${attempt} with Key #${currentKeyIndex}...`);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (text) return text;
    } catch (error) {
      console.error(`Gemini Error:`, error.message);
      if (attempt < genAIInstances.length) {
        return generateContent(prompt, feature, attempt + 1);
      }
    }
  }

  // 2. Fallback to OpenRouter
  const orResponse = await callOpenRouter(prompt);
  if (orResponse) return orResponse;

  // 3. Fallback to DeepSeek
  const dsResponse = await callDeepSeek(prompt);
  if (dsResponse) return dsResponse;

  throw new Error("All AI providers are currently unavailable.");
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1) => {
  const genAI = getNextGenAI();

  // 1. Try Gemini
  if (genAI && attempt <= genAIInstances.length) {
    try {
      console.log(`Gemini Chat Attempt ${attempt}...`);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = model.startChat({ history: history.slice(-10) });
      const result = await chat.sendMessage(message);
      const response = await result.response;
      const text = response.text();
      if (text) return text;
    } catch (error) {
      console.error(`Gemini Chat Error:`, error.message);
      if (attempt < genAIInstances.length) {
        return chatWithGemini(history, message, feature, attempt + 1);
      }
    }
  }

  // 2. Fallback to OpenRouter
  const orResponse = await callOpenRouter(message, true, history);
  if (orResponse) return orResponse;

  // 3. Fallback to DeepSeek
  const dsResponse = await callDeepSeek(message, true, history);
  if (dsResponse) return dsResponse;

  throw new Error("AI Chat is currently unavailable across all providers.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1) => {
  const genAI = getNextGenAI();
  
  if (genAI && attempt <= genAIInstances.length) {
    try {
      console.log(`Gemini Extraction Attempt ${attempt}...`);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent([
        "Extract all text from this file. It may contain student handwriting, diagrams, or printed text. If it is handwritten, do your best to transcribe it accurately. Maintain the logical structure (headings, bullet points). Return only the transcribed text.",
        { inlineData: { data: buffer.toString("base64"), mimeType } },
      ]);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error(`Gemini Extraction Error:`, error.message);
      if (attempt < genAIInstances.length) {
        return extractTextFromBuffer(buffer, mimeType, attempt + 1);
      }
    }
  }

  // Note: OCR Fallback is harder because OpenRouter/DeepSeek often don't support image-to-text for free
  // We'll stick to Gemini for OCR for now as it's the most capable free vision model
  throw new Error("OCR is currently unavailable. Please try again later.");
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
};
