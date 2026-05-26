const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  noteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
  title: { type: String, required: true },
  questions: [
    {
      question: { type: String, required: true },
      options: [{ type: String }],
      correctAnswer: { type: String, required: true },
      type: { type: String, enum: ['mcq', 'tf', 'fill'], default: 'mcq' },
      userAnswer: { type: String },
      isCorrect: { type: Boolean },
      topic: { type: String }
    }
  ],
  score: { type: Number },
  totalQuestions: { type: Number },
  subject: { type: String, default: 'General' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Quiz', quizSchema);
