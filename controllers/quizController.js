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

    if (!quizId) {
      return res.status(400).json({ message: 'Quiz ID is required' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const quizObjectId = new mongoose.Types.ObjectId(quizId);

    console.log(`Submitting score for quiz ${quizId}: ${score} (User: ${userId})`);

    // Use returnDocument: 'after' instead of new: true to avoid deprecation warning
    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizObjectId, userId: userObjectId },
      { $set: { score: Number(score) } },
      { returnDocument: 'after' }
    );

    if (!quiz) {
      console.log(`Quiz not found or unauthorized: ${quizId} for User: ${userId}`);
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    console.log(`Score saved successfully for quiz ${quizId}. New score in DB: ${quiz.score}`);
    res.json({ success: true, quiz });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ message: 'Error saving score', error: error.message });
  }
};

const getUserStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    if (!userId) {
      console.log('Stats Error: No User ID found in request');
      return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log('--- STATS CALCULATION START ---');
    console.log('Raw User ID from request:', userId);

    // Mongoose will automatically handle the conversion if we use the model's find method
    // but for aggregation and safety, we'll try to ensure we have an ObjectId if possible
    let userQueryId = userId;
    try {
      if (typeof userId === 'string' && userId.length === 24) {
        userQueryId = new mongoose.Types.ObjectId(userId);
      }
    } catch (e) {
      console.log('Note: userId is not a valid ObjectId string, using as is');
    }

    // 1. Fetch ALL quizzes for this user
    // We search by the userId as it's stored in the DB
    const allUserQuizzes = await Quiz.find({ userId: userId });
    console.log(`Debug: Total quizzes found for user ${userId}: ${allUserQuizzes.length}`);
    
    // 2. Fetch quizzes with scores
    const quizzesWithScores = allUserQuizzes.filter(q => q.score !== null && q.score !== undefined);
    console.log(`Debug: Quizzes with valid scores: ${quizzesWithScores.length}`);

    let totalQuestionsAnswered = 0;
    let totalScoreSum = 0;
    
    quizzesWithScores.forEach((q, index) => {
      const qScore = typeof q.score === 'number' ? q.score : 0;
      let qTotal = q.totalQuestions;
      
      if (!qTotal) {
        qTotal = (q.questions && q.questions.length > 0) ? q.questions.length : 5;
      }
      
      console.log(`Quiz ${index + 1}: ID=${q._id}, Score=${qScore}, Total=${qTotal}, Subject=${q.subject}`);
      
      totalQuestionsAnswered += qTotal;
      if (qTotal > 0) {
        totalScoreSum += (qScore / qTotal);
      }
    });

    const avgScore = quizzesWithScores.length > 0 ? (totalScoreSum / quizzesWithScores.length) * 100 : 0;

    // 3. Subject Accuracy (Aggregation)
    // For aggregation, we MUST use the ObjectId if the field is an ObjectId in the schema
    const subjects = await Quiz.aggregate([
      { 
        $match: { 
          userId: userQueryId, 
          score: { $ne: null }
        } 
      },
      { 
        $group: { 
          _id: "$subject", 
          totalScore: { $sum: "$score" },
          totalPossible: { 
            $sum: { 
              $cond: [
                { $gt: [{ $ifNull: ["$totalQuestions", 0] }, 0] }, 
                "$totalQuestions", 
                { $cond: [{ $isArray: "$questions" }, { $size: "$questions" }, 5] }
              ] 
            } 
          }
        } 
      },
      {
        $project: {
          _id: 1,
          accuracy: {
            $cond: [
              { $gt: ["$totalPossible", 0] },
              { $divide: ["$totalScore", "$totalPossible"] },
              0
            ]
          }
        }
      }
    ]);

    // 4. Streak calculation
    const uniqueDays = [...new Set(
      quizzesWithScores
        .filter(q => q.createdAt)
        .map(q => new Date(q.createdAt).toDateString())
    )].sort((a, b) => new Date(b) - new Date(a));

    let currentStreak = 0;
    if (uniqueDays.length > 0) {
      currentStreak = 1;
      let today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let lastQuizDate = new Date(uniqueDays[0]);
      lastQuizDate.setHours(0, 0, 0, 0);

      const diffTime = Math.abs(today - lastQuizDate);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        // Recent activity today or yesterday, count backwards
        for (let i = 0; i < uniqueDays.length - 1; i++) {
          let d1 = new Date(uniqueDays[i]); d1.setHours(0,0,0,0);
          let d2 = new Date(uniqueDays[i+1]); d2.setHours(0,0,0,0);
          const dayGap = Math.floor(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
          if (dayGap === 1) currentStreak++;
          else break;
        }
      } else {
        currentStreak = 0; // Streak broken
      }
    }

    const stats = {
      totalQuestionsAnswered: totalQuestionsAnswered,
      averageScore: Math.round(avgScore),
      streak: currentStreak,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id || 'General',
        accuracy: Math.round((s.accuracy || 0) * 100)
      })),
      debug: {
        quizzesFound: allUserQuizzes.length,
        scoredQuizzes: quizzesWithScores.length
      }
    };

    console.log('Final Calculated Stats:', JSON.stringify(stats, null, 2));
    console.log('--- STATS CALCULATION END ---');
    
    res.json(stats);
  } catch (error) {
    console.error('CRITICAL Stats error:', error);
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
