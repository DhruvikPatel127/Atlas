const Note = require('../models/Note');
const fs = require('fs');
const { extractTextFromBuffer } = require('./geminiController');

const uploadNote = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    let extractedText = '';

    try {
      console.log(`Extracting text from ${req.file.mimetype}...`);
      extractedText = await extractTextFromBuffer(dataBuffer, req.file.mimetype);
    } catch (extractionError) {
      console.error('Gemini extraction error:', extractionError);
      extractedText = "AI extraction failed for this file. Please ensure it's a valid PDF or image.";
    }

    const newNote = new Note({
      userId: userId,
      title: req.body.title || req.file.originalname,
      content: extractedText,
      fileUrl: filePath,
      fileType: req.file.mimetype,
      subject: req.body.subject || 'General',
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
    const userId = req.user.id || req.user._id;
    const notes = await Note.find({ userId: userId }).sort({ createdAt: -1 });
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

const deleteNote = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const note = await Note.findOne({ _id: req.params.id, userId: userId });
    
    if (!note) {
      return res.status(404).json({ message: 'Note not found or unauthorized' });
    }

    // Delete actual file from disk if it exists
    if (note.fileUrl && fs.existsSync(note.fileUrl)) {
      fs.unlinkSync(note.fileUrl);
    }

    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting note', error: error.message });
  }
};

module.exports = {
  uploadNote,
  getNotes,
  getNoteById,
  deleteNote,
};
