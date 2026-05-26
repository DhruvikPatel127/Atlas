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

    console.log(`Submitting score for quiz ${quizId}: ${score} (User: ${userId})`);

    if (!quizId) {
      return res.status(400).json({ message: 'Quiz ID is required' });
    }

    // Use returnDocument: 'after' instead of new: true to avoid deprecation warning
    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizId, userId: userId },
      { $set: { score: Number(score) } },
      { returnDocument: 'after' }
    );

    if (!quiz) {
      console.log(`Quiz not found or unauthorized: ${quizId}`);
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    console.log(`Score saved successfully for quiz ${quizId}. New score: ${quiz.score}`);
    res.json({ success: true, quiz });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ message: 'Error saving score', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    console.log(`Fetching stats for User: ${userId}`);

    // Find all quizzes for this user that have a score
    const quizzes = await Quiz.find({ 
      userId: userId, 
      score: { $ne: null } 
    });

    console.log(`Found ${quizzes.length} completed quizzes for user`);
    
    let totalQuestionsAnswered = 0;
    let totalScoreSum = 0;
    
    quizzes.forEach(q => {
      const qScore = q.score || 0;
      const qTotal = q.totalQuestions || 0;
      totalQuestionsAnswered += qTotal;
      if (qTotal > 0) {
        totalScoreSum += (qScore / qTotal);
      }
    });

    const avgScore = quizzes.length > 0 ? (totalScoreSum / quizzes.length) * 100 : 0;

    // 2. Subject Accuracy (Using aggregation but with careful casting)
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const subjects = await Quiz.aggregate([
      { 
        $match: { 
          userId: userObjectId, 
          score: { $ne: null },
          totalQuestions: { $gt: 0 } 
        } 
      },
      { 
        $group: { 
          _id: "$subject", 
          avgAccuracy: { $avg: { $divide: ["$score", "$totalQuestions"] } } 
        } 
      }
    ]);

    // 3. Streak
    const uniqueDays = await Quiz.distinct('createdAt', { 
      userId: userId, 
      score: { $ne: null } 
    });
    const streak = new Set(uniqueDays.map(d => new Date(d).toDateString())).size;

    const stats = {
      totalQuestionsAnswered: totalQuestionsAnswered,
      averageScore: Math.round(avgScore),
      streak: streak,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id || 'General',
        accuracy: Math.round((s.avgAccuracy || 0) * 100)
      }))
    };

    console.log('Calculated Stats:', JSON.stringify(stats));
    res.json(stats);
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
