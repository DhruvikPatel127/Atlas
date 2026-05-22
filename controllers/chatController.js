const Chat = require('../models/Chat');
const Note = require('../models/Note');
const { chatWithGemini } = require('./geminiController');

const sendMessage = async (req, res) => {
  try {
    const { noteId, message } = req.body;
    
    // Check if noteId is provided and is a valid ObjectId
    const isValidObjectId = noteId && /^[0-9a-fA-F]{24}$/.test(noteId);
    
    let chat = isValidObjectId ? await Chat.findOne({ noteId }) : null;

    let history = [];
    if (chat) {
      history = chat.messages.map(msg => ({
        role: msg.role,
        parts: msg.parts,
      }));
    } else {
      // If it's the first message and there's a valid note, provide context
      if (isValidObjectId) {
        const note = await Note.findById(noteId);
        if (note) {
          history.push({
            role: 'user',
            parts: [{ text: `Here are my notes: ${note.content}\n\nI want you to be my AI tutor. Help me understand these notes. Any questions I ask should be answered based on these notes if possible.` }],
          });
          history.push({
            role: 'model',
            parts: [{ text: "I've read your notes. How would you like to know?" }],
          });
        }
      } else {
        // Fallback for when no note is provided
        history.push({
          role: 'model',
          parts: [{ text: "Hello! I'm Atlas AI. You haven't uploaded any notes yet, but I can still help you with your studies. What would you like to learn today?" }],
        });
      }
    }

    const aiResponse = await chatWithGemini(history, message);

    if (!chat) {
      chat = new Chat({
        noteId,
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
    const chat = await Chat.findOne({ noteId: req.params.noteId });
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
