const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');

dotenv.config();

// Force the use of v1 API endpoint which is often more stable for 404 issues
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateContent = async (prompt) => {
  try {
    // Using the legacy but most reliable model identifier
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini Error:", error.message);
    
    // Final desperate fallback for region/version issues
    try {
      const modelFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await modelFlash.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (innerError) {
      console.error("All models failed. Status:", innerError.status);
      throw innerError;
    }
  }
};

const chatWithGemini = async (history, message) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    try {
      const modelFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = modelFlash.startChat({ history });
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
