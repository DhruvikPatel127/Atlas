const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Log API Key presence (safe version)
if (process.env.GEMINI_API_KEY) {
  console.log("API Key found. Length:", process.env.GEMINI_API_KEY.length);
} else {
  console.error("API Key NOT found in environment variables!");
}

const generateContent = async (prompt) => {
  try {
    // Attempt with the most robust model string for v1 API
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini AI Error:", error.message);
    
    // Fallback logic
    try {
      console.log("Attempting fallback with gemini-pro...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
      const result = await fallbackModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (fallbackError) {
      console.error("All models failed. This is likely an API Key or Project configuration issue.");
      throw fallbackError;
    }
  }
};

const chatWithGemini = async (history, message) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini AI Chat Error:", error.message);
    
    try {
      console.log("Attempting chat fallback with gemini-pro...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
      const chat = fallbackModel.startChat({ history });
      const result = await chat.sendMessage(message);
      const response = await result.response;
      return response.text();
    } catch (fallbackError) {
      throw fallbackError;
    }
  }
};

module.exports = {
  generateContent,
  chatWithGemini
};
