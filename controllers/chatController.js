const Chat = require('../models/Chat');
const Note = require('../models/Note');
const User = require('../models/User');
const { chatWithGemini } = require('./geminiController');

const sendMessage = async (req, res) => {
  try {
    const { noteId, message } = req.body;
    
    // Check if noteId is provided and is a valid ObjectId
    const isValidObjectId = noteId && /^[0-9a-fA-F]{24}$/.test(noteId);
    
    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    // If noteId is provided, check if it's a valid ObjectId. If not, treat as general chat (null)
    const normalizedNoteId = (noteId && /^[0-9a-fA-F]{24}$/.test(noteId)) ? noteId : null;

    let chat = await Chat.findOne({ noteId: normalizedNoteId, userId: userId });

    let history = [];
    if (chat) {
      history = chat.messages.map(msg => ({
        role: msg.role,
        parts: msg.parts.map(p => ({ text: p.text })),
      }));
    } else {
      // If it's the first message and there's a valid note, provide context
      if (normalizedNoteId) {
        const note = await Note.findById(normalizedNoteId);
        if (note) {
          // Gemini requires the first message to be from 'user'
          history.push({
            role: 'user',
            parts: [{ text: `System: Use these notes for context: ${note.content}\n\nUser: Hi, I'd like to discuss these notes.` }],
          });
          history.push({
            role: 'model',
            parts: [{ text: "I've read your notes. How would you like to know?" }],
          });
        }
      } else {
        // Fallback for when no note is provided
        // Start with user message then model response to satisfy Gemini requirement
        history.push({
          role: 'user',
          parts: [{ text: "Hello Atlas AI." }],
        });
        history.push({
          role: 'model',
          parts: [{ text: "Hello! I'm Atlas AI. You haven't uploaded any notes yet, but I can still help you with your studies. What would you like to learn today?" }],
        });
      }
    }

    const aiResponse = await chatWithGemini(history, message);

    // Increment AI usage counter
    await User.findByIdAndUpdate(userId, { $inc: { ai_questions_today: 1 } });

    if (!chat) {
      chat = new Chat({
        userId: userId,
        noteId: normalizedNoteId,
        messages: [
          ...history,
          { role: 'user', parts: [{ text: message }] },
          { role: 'model', parts: [{ text: aiResponse }] }
        ]
      });
    } else {
      chat.messages.push({ role: 'user', parts: [{ text: message }] });
      chat.messages.push({ role: 'model', parts: [{ text: aiResponse }] });
    }

    await chat.save();
    res.json({ response: aiResponse, chat });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ message: 'Error in chat', error: error.message });
  }
};

const getChatByNoteId = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const noteId = (req.params.noteId && /^[0-9a-fA-F]{24}$/.test(req.params.noteId)) ? req.params.noteId : null;
    const chat = await Chat.findOne({ noteId, userId: userId });
    if (!chat) return res.json({ messages: [] });
    res.json(chat);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching chat', error: error.message });
  }
};

module.exports = {
  sendMessage,
  getChatByNoteId,
};
