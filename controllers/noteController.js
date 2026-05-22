const Note = require('../models/Note');
const pdf = require('pdf-parse');
const fs = require('fs');

const uploadNote = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    let extractedText = '';

    if (req.file.mimetype === 'application/pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      try {
        const data = await pdf(dataBuffer);
        extractedText = data.text;
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        extractedText = "Error extracting text from PDF. The file might be corrupted or protected.";
      }
    } else {
      // For images, we would ideally use OCR (like Tesseract.js or Gemini Vision API)
      // For now, let's just mark it as "Image content needs OCR"
      extractedText = "Image content processing not fully implemented. Please use PDF for better results.";
    }

    const newNote = new Note({
      title: req.body.title || req.file.originalname,
      content: extractedText,
      fileUrl: filePath,
      fileType: req.file.mimetype,
    });

    await newNote.save();
    res.status(201).json(newNote);
  } catch (error) {
    console.error('Error uploading note:', error);
    res.status(500).json({ message: 'Error processing note', error: error.message });
  }
};

const getNotes = async (req, res) => {
  try {
    const notes = await Note.find().sort({ createdAt: -1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching notes', error: error.message });
  }
};

const getNoteById = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) return res.status(404).json({ message: 'Note not found' });
    res.json(note);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching note', error: error.message });
  }
};

module.exports = {
  uploadNote,
  getNotes,
  getNoteById,
};
