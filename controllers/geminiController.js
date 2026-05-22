const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use gemini-1.5-flash-latest or gemini-1.5-flash for better compatibility
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const generateContent = async (prompt) => {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini AI Error:", error);
    throw error;
  }
};

const chatWithGemini = async (history, message) => {
  try {
    const chat = model.startChat({
      history: history,
    });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini AI Chat Error:", error);
    throw error;
  }
};

module.exports = {
  generateContent,
  chatWithGemini
};
