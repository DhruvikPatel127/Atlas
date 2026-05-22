const Flashcard = require('../models/Flashcard');
const Note = require('../models/Note');
const { generateContent } = require('./geminiController');

const generateFlashcards = async (req, res) => {
  try {
    const { noteId } = req.body;

    // Validate noteId
    if (!noteId || !/^[0-9a-fA-F]{24}$/.test(noteId)) {
      return res.status(400).json({ message: 'A valid Note ID is required to generate flashcards' });
    }

    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const prompt = `Based on the following notes, generate 10 flashcards. 
    Return the response in JSON format like this:
    {
      "title": "Flashcards Title",
      "cards": [
        {
          "front": "Question or Term",
          "back": "Answer or Definition"
        }
      ]
    }
    Notes: ${note.content}`;

    const aiResponse = await generateContent(prompt);
    
    // Clean up the response
    const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();
    const flashcardData = JSON.parse(cleanedResponse);

    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    const newFlashcardSet = new Flashcard({
      userId: userId,
      noteId,
      title: flashcardData.title,
      cards: flashcardData.cards,
    });

    await newFlashcardSet.save();
    res.status(201).json(newFlashcardSet);
  } catch (error) {
    console.error('Flashcard generation error:', error);
    res.status(500).json({ message: 'Error generating flashcards', error: error.message });
  }
};

const getFlashcardsByNoteId = async (req, res) => {
  try {
    const flashcards = await Flashcard.find({ noteId: req.params.noteId, userId: req.user.id });
    res.json(flashcards);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching flashcards', error: error.message });
  }
};

module.exports = {
  generateFlashcards,
  getFlashcardsByNoteId,
};
