const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');
const dotenv = require('dotenv');
const { aiRequestCounter, aiTokensUsed } = require('../config/monitoring');

dotenv.config();

// Initialize genAI only if key is available
let genAI;
if (process.env.GEMINI_API_KEY) {
  const apiKey = process.env.GEMINI_API_KEY.trim().replace(/["']/g, '');
  genAI = new GoogleGenerativeAI(apiKey);
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const USE_OPENROUTER = process.env.USE_OPENROUTER === 'true';

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
    return await generateWithOpenRouter(prompt, feature);
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
          },
        }
      );

      const text = response.data.choices[0].message.content;
      return text;
    } catch (error) {
      console.error('OpenRouter Chat Error:', error.message);
      throw new Error("Chat failed via OpenRouter.");
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

const extractTextFromBuffer = async (buffer, mimeType) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is missing. Please set it in your environment variables.");
  }
  
  const modelName = MODELS.gemini;
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
    console.error(`Extraction error (${modelName}):`, error.message);
    throw error;
  }
};

const generateRevisionNotes = async (content) => {
  const prompt = `Convert the following notes into a concise 2-page revision sheet. 
  Include:
  1. Key Formulas (if applicable)
  2. Core Definitions
  3. Quick Tricks/Mnemonics for memorization
  4. Summary in simple language
  
  Format it with clear headings and bullet points.
  
  Notes: ${content}`;
  
  return await generateContent(prompt, 'revision');
};

const generateExamMode = async (content) => {
  const prompt = `You are an exam predictor. Based on the following study material, generate the "Night Before Exam" package:
  1. Top 10 Most Probable Questions
  2. 5 High-Weightage Concepts to focus on
  3. A 5-minute rapid revision summary
  
  Notes: ${content}`;
  
  return await generateContent(prompt, 'exam_mode');
};

const predictHighlights = async (content) => {
  const prompt = `Analyze the following notes and identify the "Smart Highlights":
  1. Top 5 most important lines.
  2. Concepts with 80%+ probability of appearing in exams.
  3. Key technical terms that must be memorized.
  
  Notes: ${content}`;
  
  return await generateContent(prompt, 'highlights');
};

const generateRoadmap = async (subjects, examDate, backlog, hoursPerDay) => {
  const prompt = `Generate a Semester Study Roadmap for a student with the following details:
  Subjects: ${subjects.join(', ')}
  Exam Date: ${examDate}
  Backlog: ${backlog}
  Available Study Hours: ${hoursPerDay} hours/day
  
  Please provide a structured daily/weekly plan that includes:
  1. Priority subjects to tackle first.
  2. Revision slots.
  3. Strategy to clear backlogs.
  4. Motivation tip.
  
  Format it with clear headings.`;
  
  return await generateContent(prompt, 'roadmap');
};

module.exports = {
  generateContent,
  chatWithGemini,
  extractTextFromBuffer,
  generateRevisionNotes,
  generateExamMode,
  predictHighlights,
  generateRoadmap,
};
