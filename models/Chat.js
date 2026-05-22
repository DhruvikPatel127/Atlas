const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
  messages: [
    {
      role: { type: String, enum: ['user', 'model'], required: true },
      parts: [{ text: { type: String, required: true } }],
      timestamp: { type: Date, default: Date.now }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', chatSchema);
