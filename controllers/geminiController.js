const { GoogleGenAI } = require("@google/genai");
const dotenv = require('dotenv');
const axios = require('axios');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Support multiple API keys for rotation using the NEW @google/genai SDK
let aiInstances = [];
let currentKeyIndex = 0;

if (process.env.GEMINI_API_KEY) {
  // Support comma-separated keys: KEY1,KEY2,KEY3
  // Aggressively clean keys from whitespace, quotes, and newlines
  const keys = process.env.GEMINI_API_KEY.split(',')
    .map(k => k.trim().replace(/["'\r\n]/g, ''))
    .filter(k => k.length > 0);
  
  // Use the new SDK initialization from documentation
  aiInstances = keys.map(key => new GoogleGenAI({ apiKey: key }));
  console.log(`Initialized AI Rotation with ${aiInstances.length} cleaned API keys using @google/genai SDK.`);
}

const getNextAI = () => {
  if (aiInstances.length === 0) return null;
  const instance = aiInstances[currentKeyIndex];
  // Rotate index for next time
  currentKeyIndex = (currentKeyIndex + 1) % aiInstances.length;
  return instance;
};

// Comprehensive fallback chain for maximum reliability
// gemini-3.5-flash is preferred by user, but we keep others as fallback
const MODELS = [
  "gemini-3.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];

const generateContent = async (prompt, feature = 'general', attempt = 1, forceJson = false, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (!ai) throw new Error("GEMINI_API_KEY is missing.");

  try {
    console.log(`[AI] Attempt ${attempt} | Model: ${currentModel} | Key: #${currentKeyIndex}`);
    
    const response = await ai.models.generateContent({
      model: currentModel,
      contents: prompt,
      config: {
        maxOutputTokens: feature === 'whiteboard_script' ? 4096 : 2048,
        temperature: forceJson ? 0.1 : 0.7,
        responseMimeType: forceJson ? "application/json" : "text/plain",
      }
    });
    
    const text = response.text;
    if (text) {
      aiRequestCounter.labels(feature, currentModel, 'success').inc();
      return text;
    }
    throw new Error("Empty response");
  } catch (error) {
    const errorMsg = (error.message || "").toLowerCase();
    console.error(`[AI Error] ${currentModel}:`, errorMsg);
    
    // 1. Transient errors (Rate limit, Overloaded, Service Unavailable)
    const isTransient = errorMsg.includes("429") || 
                        errorMsg.includes("503") || 
                        errorMsg.includes("overloaded") || 
                        errorMsg.includes("demand") ||
                        errorMsg.includes("deadline") ||
                        errorMsg.includes("timeout");

    if (isTransient && attempt < (aiInstances.length * 2)) {
      // Exponential backoff: 1.5s, 3s, 4.5s...
      const delay = attempt * 1500;
      console.log(`Transient error. Retrying with next key in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return generateContent(prompt, feature, attempt + 1, forceJson, modelIndex);
    }
    
    // 2. Model specific errors or keys exhausted -> Fallback to next model
    if (modelIndex < MODELS.length - 1) {
      console.log(`Switching model from ${currentModel} to ${MODELS[modelIndex + 1]}`);
      return generateContent(prompt, feature, 1, forceJson, modelIndex + 1);
    }
    
    throw new Error("AI is temporarily unavailable across all models and keys. Please try again later.");
  }
};

const chatWithGemini = async (history, message, feature = 'chat', attempt = 1, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (ai) {
    try {
      console.log(`Attempting chat (Attempt ${attempt}) with Key #${currentKeyIndex} using ${currentModel}...`);
      
      const contents = [
        ...history.map(h => ({
          role: h.role === 'model' ? 'assistant' : h.role,
          parts: [{ text: h.parts[0].text }]
        })),
        { role: 'user', parts: [{ text: message }] }
      ];

      const response = await ai.models.generateContent({
        model: currentModel,
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
      console.error(`Gemini Chat Error (${currentModel}):`, errorMsg);
      
      if ((errorMsg.includes("503") || errorMsg.includes("429") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < (aiInstances.length * 2)) {
        const delay = (attempt * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return chatWithGemini(history, message, feature, attempt + 1, modelIndex);
      }

      if (modelIndex < MODELS.length - 1) {
        return chatWithGemini(history, message, feature, 1, modelIndex + 1);
      }
    }
  }

  throw new Error("Chat is temporarily unavailable.");
};

const extractTextFromBuffer = async (buffer, mimeType, attempt = 1, modelIndex = 0) => {
  const ai = getNextAI();
  const currentModel = MODELS[modelIndex];
  
  if (!ai) throw new Error("AI not initialized");

  try {
    console.log(`Attempting extraction (Attempt ${attempt}) with Key #${currentKeyIndex} using ${currentModel}...`);
    
    const response = await ai.models.generateContent({
      model: currentModel,
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
    console.error(`Extraction error (${currentModel}):`, errorMsg);
    
    if ((errorMsg.includes("429") || errorMsg.includes("503") || errorMsg.includes("demand") || errorMsg.includes("404")) && attempt < (aiInstances.length * 2)) {
      const delay = (attempt * 2000) + 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractTextFromBuffer(buffer, mimeType, attempt + 1, modelIndex);
    }

    if (modelIndex < MODELS.length - 1) {
      return extractTextFromBuffer(buffer, mimeType, 1, modelIndex + 1);
    }
    
    throw error;
  }
};

/**
 * Robustly parses AI responses into JSON objects.
 * Handles markdown wrapping, extra text, and basic truncation.
 */
const safeParseAIResponse = (text) => {
  if (!text) return null;
  
  let cleaned = text.trim();
  
  // 1. Remove markdown code blocks if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }
  
  cleaned = cleaned.trim();

  // 2. Try to find the first '{' and last '}'
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  
  if (start !== -1) {
    if (end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
    } else {
      // Truncated or missing end
      cleaned = cleaned.substring(start);
    }
  }

  // 3. Aggressive cleaning (trailing commas, comments, unescaped characters)
  // Remove illegal characters at the very start (e.g., invisible bytes or non-JSON text)
  cleaned = cleaned.replace(/^[^{]*/, '');
  
  // Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');

  // Fix common "3.5-flash" unescaped character issues
  cleaned = cleaned.replace(/\n/g, ' '); // Replace all newlines with spaces for parsing
  cleaned = cleaned.replace(/\r/g, ''); 

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Initial JSON Parse Failed. Attempting aggressive repair...', e.message);
    
    // Aggressive repair for truncated or poorly escaped JSON
    try {
      // 1. If we are stuck inside an unclosed string, close it
      const lastQuote = cleaned.lastIndexOf('"');
      const lastColon = cleaned.lastIndexOf(':');
      const lastOpenBrace = cleaned.lastIndexOf('{');
      const lastCloseBrace = cleaned.lastIndexOf('}');
      
      if (lastQuote > lastColon && lastQuote > lastOpenBrace && lastQuote > lastCloseBrace) {
        // We are likely inside a string value (like narration)
        cleaned += '"';
      }

      // 2. Fix missing closing brackets for nested structures
      let openBraces = (cleaned.match(/\{/g) || []).length;
      let closeBraces = (cleaned.match(/\}/g) || []).length;
      while (closeBraces < openBraces) {
        cleaned += '}';
        closeBraces++;
      }
      
      let openBrackets = (cleaned.match(/\[/g) || []).length;
      let closeBrackets = (cleaned.match(/\}/g) || []).length; // Check if we meant ]
      
      // Re-calculate brackets properly
      openBrackets = (cleaned.match(/\[/g) || []).length;
      closeBrackets = (cleaned.match(/\]/g) || []).length;
      while (closeBrackets < openBrackets) {
        cleaned += ']';
        closeBrackets++;
      }
      
      // Final attempt at parsing after structure repair
      return JSON.parse(cleaned);
    } catch (innerError) {
      console.error('Aggressive Repair Failed:', innerError.message);
      
      // LAST RESORT: Manual regex extraction if JSON is completely broken
      try {
        const steps = [];
        const stepRegex = /\{\s*"title":\s*"([^"]+)"\s*,\s*"writing":\s*"([^"]+)"\s*,\s*"narration":\s*"([^"]+)"\s*\}/g;
        let match;
        while ((match = stepRegex.exec(cleaned)) !== null) {
          steps.push({ title: match[1], writing: match[2], narration: match[3] });
        }
        if (steps.length > 0) return { steps };
      } catch (regexError) {
        return null;
      }
      return null;
    }
  }
};

module.exports = { 
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
  safeParseAIResponse
};
