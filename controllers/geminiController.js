const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');

dotenv.config();

// Initialize the API with a fallback for the version
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateContent = async (prompt) => {
  try {
    // Try the v1 API explicitly by using a different approach if available
    // or just sticking to the most basic model call
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Gemini Error:", error.message);
    
    // If 404, it might be the version in the URL. 
    // The SDK defaults to v1beta. Let's try to force a simple model name.
    try {
      const modelPro = genAI.getGenerativeModel({ model: "gemini-pro" });
      const result = await modelPro.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (innerError) {
      throw innerError;
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
    try {
      const modelPro = genAI.getGenerativeModel({ model: "gemini-pro" });
      const chat = modelPro.startChat({ history });
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
