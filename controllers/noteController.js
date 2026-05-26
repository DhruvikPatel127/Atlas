const Note = require('../models/Note');
const Quiz = require('../models/Quiz');
const Flashcard = require('../models/Flashcard');
const User = require('../models/User');
const fs = require('fs');
const { extractText } = require('../utils/ocrService');
const { generateContent } = require('./aiController');

const generateAllFeatures = async (req, res) => {
  try {
    const { noteId } = req.body;
    const userId = req.user.id || req.user._id;

    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const prompt = `Based on the following study notes, generate a comprehensive study pack.
    Return ONLY a JSON object with this exact structure:
    {
      "summary": "A concise 3-4 sentence summary of the key concepts",
      "quiz": {
        "title": "Quick Knowledge Check",
        "questions": [
          {
            "question": "Question text?",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correctAnswer": "Option A"
          }
        ]
      },
      "flashcards": [
        {
          "front": "Term or Concept",
          "back": "Definition or Explanation"
        }
      ]
    }
    Generate 5 quiz questions and 5 flashcards.
    
    Notes Content: ${note.content}`;

    const aiResponse = await generateContent(prompt, 'generate_all');
    
    // Clean and parse
    const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();
    const data = JSON.parse(cleanedResponse);

    // 1. Update Note with Summary (assuming we want to store it there or just return it)
    note.summary = data.summary;
    await note.save();

    // 2. Create Quiz
    const newQuiz = new Quiz({
      userId,
      noteId,
      title: data.quiz.title,
      questions: data.quiz.questions,
      totalQuestions: data.quiz.questions.length,
      subject: note.subject || 'General'
    });
    await newQuiz.save();

    // 3. Create Flashcards
    const newFlashcardSet = new Flashcard({
      userId,
      noteId,
      title: `${note.title} - Flashcards`,
      cards: data.flashcards
    });
    await newFlashcardSet.save();

    // Increment AI usage
    await User.findByIdAndUpdate(userId, { $inc: { ai_questions_today: 1 } });

    res.json({
      message: 'Study pack generated successfully!',
      summary: data.summary,
      quizId: newQuiz._id,
      flashcardId: newFlashcardSet._id,
      quiz: newQuiz,
      flashcards: newFlashcardSet
    });

  } catch (error) {
    console.error('Generate All Error:', error);
    res.status(500).json({ message: 'Error generating study pack', error: error.message });
  }
};

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
      console.log(`Extracting text using Tesseract/OCR from ${req.file.mimetype}...`);
      extractedText = await extractText(dataBuffer, req.file.mimetype);
    } catch (extractionError) {
      console.error('OCR extraction error:', extractionError);
      extractedText = "OCR extraction failed for this file. Please ensure it's a valid PDF or image.";
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
  generateAllFeatures,
};
