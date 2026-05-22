const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');

dotenv.config();

// Using the exact model name you found: 'gemini-3.5-flash'
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateContent = async (prompt) => {
  try {
    // Attempt with your requested model: gemini-3.5-flash
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini Error:", error.message);
    
    // Fallback logic in case the new model is not yet available in your region
    try {
      console.log("Attempting fallback to gemini-1.5-flash...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await fallbackModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (innerError) {
      console.error("Critical: All models failed. Please verify your API Key and Region.");
      throw innerError;
    }
  }
};

const chatWithGemini = async (history, message) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    try {
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = fallbackModel.startChat({ history });
      const result = await chat.sendMessage(message);
      const response = await result.response;
      return response.text();
    } catch (innerError) {
      throw innerError;
    }
  }
};

module.exports = {
  generateContent,
  chatWithGemini
};
