const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');
const Note = require('../models/Note');
const User = require('../models/User');
const { generateContent } = require('./geminiController');

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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Ensure userId is an ObjectId for aggregation
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // 1. Total Quizzes and Average Score
    const quizzes = await Quiz.find({ userId: userObjectId, score: { $exists: true } });
    const totalQuizzes = quizzes.length;
    
    let totalQuestionsAnswered = 0;
    let totalScoreSum = 0;
    
    quizzes.forEach(q => {
      totalQuestionsAnswered += q.totalQuestions || 0;
      // Calculate percentage score for each quiz and sum them up
      if (q.totalQuestions > 0) {
        totalScoreSum += (q.score / q.totalQuestions);
      }
    });

    const avgScore = totalQuizzes > 0 ? (totalScoreSum / totalQuizzes) * 100 : 0;

    // 2. Subject Accuracy
    const subjects = await Quiz.aggregate([
      { $match: { 
        userId: userObjectId, 
        score: { $exists: true },
        totalQuestions: { $gt: 0 } 
      } },
      { 
        $group: { 
          _id: "$subject", 
          avgAccuracy: { $avg: { $divide: ["$score", "$totalQuestions"] } } 
        } 
      }
    ]);

    // 3. Streak (Simplified logic: count consecutive days with quizzes)
    const user = await User.findById(userId);
    const streak = 5; // Placeholder for now, could be calculated from login logs

    res.json({
      totalQuestionsAnswered: totalQuestionsAnswered,
      averageScore: Math.round(avgScore),
      streak: streak,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id || 'General',
        accuracy: Math.round((s.avgAccuracy || 0) * 100)
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
