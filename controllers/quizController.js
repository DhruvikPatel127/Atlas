const Quiz = require('../models/Quiz');
const Note = require('../models/Note');
const { generateContent } = require('./aiController');

const generateQuiz = async (req, res) => {
  try {
    const { noteId } = req.body;
    
    // Validate noteId
    if (!noteId || !/^[0-9a-fA-F]{24}$/.test(noteId)) {
      return res.status(400).json({ message: 'A valid Note ID is required to generate a quiz' });
    }

    const note = await Note.findById(noteId);
    if (!note) return res.status(404).json({ message: 'Note not found' });

    const prompt = `Based on the following notes, generate a quiz with 5 multiple-choice questions. 
    Return the response in JSON format like this:
    {
      "title": "Quiz Title",
      "questions": [
        {
          "question": "Question text?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A"
        }
      ]
    }
    Notes: ${note.content}`;

    const aiResponse = await generateContent(prompt, 'quiz');
    
    // Clean up the response (Gemini sometimes adds markdown backticks)
    const cleanedResponse = aiResponse.replace(/```json|```/g, '').trim();
    const quizData = JSON.parse(cleanedResponse);

    const userId = req.user.id || req.user._id;
    if (!userId) {
      return res.status(401).json({ message: 'User ID not found in token. Please log in again.' });
    }

    // Increment AI usage counter
    const User = require('../models/User');
    await User.findByIdAndUpdate(userId, { $inc: { ai_questions_today: 1 } });

    const newQuiz = new Quiz({
      userId: userId,
      noteId: noteId,
      title: note.title,
      subject: note.subject || 'General',
      questions: quizData.questions,
      totalQuestions: quizData.questions.length
    });

    await newQuiz.save();
    res.status(201).json(newQuiz);
  } catch (error) {
    console.error('Quiz generation error:', error);
    res.status(500).json({ message: 'Error generating quiz', error: error.message });
  }
};

const submitQuizScore = async (req, res) => {
  try {
    const { quizId, score } = req.body;
    const userId = req.user.id || req.user._id;

    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizId, userId: userId },
      { score: score },
      { new: true }
    );

    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    
    res.json({ success: true, quiz });
  } catch (error) {
    res.status(500).json({ message: 'Error saving score', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    // 1. Total Quizzes and Average Score
    const quizzes = await Quiz.find({ userId: userId, score: { $exists: true } });
    const totalQuizzes = quizzes.length;
    const avgScore = totalQuizzes > 0 
      ? (quizzes.reduce((acc, q) => acc + (q.score / q.totalQuestions), 0) / totalQuizzes) * 100 
      : 0;

    // 2. Subject Accuracy
    const subjects = await Quiz.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), score: { $exists: true } } },
      { 
        $group: { 
          _id: "$subject", 
          avgAccuracy: { $avg: { $divide: ["$score", "$totalQuestions"] } } 
        } 
      }
    ]);

    // 3. Streak (Mock logic for now - can be enhanced with daily visit tracking)
    const user = await User.findById(userId);
    const streak = 12; // In real app, track daily logins

    res.json({
      totalQuestionsAnswered: quizzes.reduce((acc, q) => acc + q.totalQuestions, 0),
      averageScore: Math.round(avgScore),
      streak: streak,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id,
        accuracy: Math.round(s.avgAccuracy * 100)
      }))
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
};

const getQuizzesByNoteId = async (req, res) => {
  try {
    const quizzes = await Quiz.find({ noteId: req.params.noteId, userId: req.user.id });
    res.json(quizzes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching quizzes', error: error.message });
  }
};

module.exports = {
  generateQuiz,
  submitQuizScore,
  getUserStats,
  getQuizzesByNoteId,
};
