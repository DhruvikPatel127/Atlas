const Tesseract = require('tesseract.js');
const pdf = require('pdf-parse');
const fs = require('fs');

/**
 * Extracts text from an image buffer using Tesseract.js
 * @param {Buffer} buffer 
 * @returns {Promise<string>}
 */
const extractTextFromImage = async (buffer) => {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
      logger: m => console.log(m.status, Math.round(m.progress * 100) + '%')
    });
    return text;
  } catch (error) {
    console.error('Tesseract OCR Error:', error);
    throw new Error('Failed to extract text from image');
  }
};

/**
 * Extracts text from a PDF buffer using pdf-parse
 * @param {Buffer} buffer 
 * @returns {Promise<string>}
 */
const extractTextFromPDF = async (buffer) => {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    console.error('PDF Parse Error:', error);
    throw new Error('Failed to extract text from PDF');
  }
};

/**
 * General text extraction service based on mime type
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {Promise<string>}
 */
const extractText = async (buffer, mimeType) => {
  if (mimeType.startsWith('image/')) {
    return await extractTextFromImage(buffer);
  } else if (mimeType === 'application/pdf') {
    return await extractTextFromPDF(buffer);
  } else {
    // Fallback for text files or unknown types
    return buffer.toString('utf8');
  }
};

module.exports = {
  extractText,
  extractTextFromImage,
  extractTextFromPDF
};
