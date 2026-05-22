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

// Function to try multiple models in order of preference
const getModelResponse = async (prompt, isChat = false, history = []) => {
  const modelsToTry = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-pro",
    "gemini-1.0-pro"
  ];

  let lastError;

  for (const modelName of modelsToTry) {
    try {
      console.log(`Attempting with model: ${modelName}`);
      const currentModel = genAI.getGenerativeModel({ model: modelName });
      
      if (isChat) {
        const chat = currentModel.startChat({ history });
        const result = await chat.sendMessage(message);
        const response = await result.response;
        return response.text();
      } else {
        const result = await currentModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
      }
    } catch (error) {
      console.error(`Model ${modelName} failed:`, error.message);
      lastError = error;
      // If it's not a 404, it might be a quota or key issue, so we might want to stop
      if (error.status !== 404) {
        // Continue to next model if it's a 404, otherwise throw
        // throw error; 
      }
    }
  }
  throw lastError;
};

const generateContent = async (prompt) => {
  try {
    // Attempt with 1.5-flash with explicit prefix
    const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Primary model error:", error.message);
    
    // Fallback logic
    const fallbacks = ["models/gemini-pro", "models/gemini-1.0-pro", "gemini-1.5-flash", "gemini-pro"];
    for (const fb of fallbacks) {
      try {
        console.log(`Attempting fallback with ${fb}...`);
        const fbModel = genAI.getGenerativeModel({ model: fb });
        const result = await fbModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } catch (fbErr) {
        console.error(`${fb} fallback failed:`, fbErr.message);
      }
    }
    throw error;
  }
};

const chatWithGemini = async (history, message) => {
  try {
    const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Primary chat error:", error.message);
    
    const fallbacks = ["models/gemini-pro", "models/gemini-1.0-pro", "gemini-1.5-flash", "gemini-pro"];
    for (const fb of fallbacks) {
      try {
        console.log(`Attempting chat fallback with ${fb}...`);
        const fbModel = genAI.getGenerativeModel({ model: fb });
        const chat = fbModel.startChat({ history });
        const result = await chat.sendMessage(message);
        const response = await result.response;
        return response.text();
      } catch (fbErr) {
        console.error(`${fb} chat fallback failed:`, fbErr.message);
      }
    }
    throw error;
  }
};

module.exports = {
  generateContent,
  chatWithGemini
};
