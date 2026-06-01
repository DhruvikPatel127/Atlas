const Chat = require('../models/Chat');
const Note = require('../models/Note');
const User = require('../models/User');
const { chatWithGemini } = require('./geminiController');

const sendMessage = async (req, res) => {
  try {
    const { noteId, subject, message } = req.body;
    
    // Check if noteId is provided and is a valid ObjectId
    const isValidObjectId = noteId && /^[0-9a-fA-F]{24}$/.test(noteId);
    
    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    // Determine the query criteria
    let query = { userId: userId };
    const normalizedNoteId = isValidObjectId ? noteId : null;
    
    if (normalizedNoteId) {
      query.noteId = normalizedNoteId;
    } else if (subject && subject !== 'All') {
      query.subject = subject;
      query.noteId = null; // Ensure we don't match a note-specific chat
    } else {
      query.noteId = null;
      query.subject = { $exists: false }; // General chat
    }

    let chat = await Chat.findOne(query);

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
          history.push({
            role: 'user',
            parts: [{ text: `System: Use these notes for context: ${note.content}\n\nUser: Hi, I'd like to discuss these notes.` }],
          });
          history.push({
            role: 'model',
            parts: [{ text: "I've read your notes. How would you like to know?" }],
          });
        }
      } else if (subject && subject !== 'All') {
        // Subject-specific welcome + Context from all notes in this subject
        const notes = await Note.find({ userId: userId, subject: subject });
        let context = "";
        if (notes.length > 0) {
          context = "System: Use these notes for context on " + subject + ":\n" + 
                    notes.map(n => n.content).join("\n\n") + "\n\n";
        }

        history.push({
          role: 'user',
          parts: [{ text: `${context}Hello Atlas AI. Let's talk about ${subject}.` }],
        });
        history.push({
          role: 'model',
          parts: [{ text: notes.length > 0 
            ? `Hello! I've analyzed your notes for ${subject}. What specific topic should we dive into?` 
            : `Hello! I'm ready to help you with ${subject}. You haven't uploaded any notes for this subject yet, but I can still help you. What would you like to learn?` }],
        });
      } else {
        // Fallback for general chat
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
        subject: (!normalizedNoteId && subject !== 'All') ? subject : undefined,
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
    const { noteId } = req.params;
    const { subject } = req.query;

    let query = { userId: userId };
    const isValidObjectId = noteId && /^[0-9a-fA-F]{24}$/.test(noteId);

    if (isValidObjectId) {
      query.noteId = noteId;
    } else if (subject && subject !== 'null' && subject !== 'All') {
      query.subject = subject;
      query.noteId = null;
    } else {
      query.noteId = null;
      query.subject = { $exists: false };
    }

    const chat = await Chat.findOne(query);
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
