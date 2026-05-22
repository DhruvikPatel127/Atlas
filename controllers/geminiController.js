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

// Using the most standard model name
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const generateContent = async (prompt) => {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    if (error.status === 404) {
      console.log("Model not found, trying fallback gemini-pro...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
      const result = await fallbackModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    }
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
    if (error.status === 404) {
      console.log("Chat model not found, trying fallback gemini-pro...");
      const fallbackModel = genAI.getGenerativeModel({ model: "gemini-pro" });
      const chat = fallbackModel.startChat({ history });
      const result = await chat.sendMessage(message);
      const response = await result.response;
      return response.text();
    }
    console.error("Gemini AI Chat Error:", error);
    throw error;
  }
};

module.exports = {
  generateContent,
  chatWithGemini
};
