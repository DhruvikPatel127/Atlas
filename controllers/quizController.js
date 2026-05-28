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
    console.log('Target User ID:', userId);

    // CRITICAL: Explicitly cast to ObjectId for all queries
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    // 1. Fetch ALL quizzes for this user to debug - searching by both ObjectId and string ID for robustness
    const allUserQuizzes = await Quiz.find({ 
      $or: [
        { userId: userObjectId },
        { userId: userId.toString() }
      ]
    });
    console.log(`Debug: Total quizzes found for user in DB: ${allUserQuizzes.length}`);
    
    // 2. Fetch quizzes with scores
    const quizzesWithScores = allUserQuizzes.filter(q => q.score !== null && q.score !== undefined);
    console.log(`Debug: Quizzes with valid scores: ${quizzesWithScores.length}`);

    let totalQuestionsAnswered = 0;
    let totalScoreSum = 0;
    
    quizzesWithScores.forEach((q, index) => {
      // Robustly get score and total questions
      const qScore = typeof q.score === 'number' ? q.score : 0;
      
      // Try to get total questions from various possible fields
      let qTotal = q.totalQuestions;
      if (qTotal === undefined || qTotal === null || qTotal === 0) {
        qTotal = (q.questions && q.questions.length > 0) ? q.questions.length : 5; // Fallback to 5 if unknown
      }
      
      console.log(`Quiz ${index + 1}: ID=${q._id}, Score=${qScore}, Total=${qTotal}, Subject=${q.subject}`);
      
      totalQuestionsAnswered += qTotal;
      if (qTotal > 0) {
        totalScoreSum += (qScore / qTotal);
      }
    });

    const avgScore = quizzesWithScores.length > 0 ? (totalScoreSum / quizzesWithScores.length) * 100 : 0;

    // 3. Subject Accuracy (Aggregation) - Improved with fallbacks and flexible userId
    const subjects = await Quiz.aggregate([
      { 
        $match: { 
          $or: [
            { userId: userObjectId },
            { userId: userId.toString() }
          ],
          score: { $ne: null }
        } 
      },
      { 
        $group: { 
          _id: "$subject", 
          avgScore: { $avg: "$score" },
          avgTotal: { 
            $avg: { 
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
          avgAccuracy: {
            $cond: [
              { $gt: ["$avgTotal", 0] },
              { $divide: ["$avgScore", "$avgTotal"] },
              0
            ]
          }
        }
      }
    ]);

    // 4. Streak (Unique Days)
    const uniqueDays = [...new Set(
      quizzesWithScores
        .filter(q => q.createdAt)
        .map(q => new Date(q.createdAt).toDateString())
    )].sort((a, b) => new Date(b) - new Date(a));

    // Calculate actual consecutive day streak
    let currentStreak = 0;
    if (uniqueDays.length > 0) {
      currentStreak = 1;
      let today = new Date();
      today.setHours(0, 0, 0, 0);
      
      let lastDate = new Date(uniqueDays[0]);
      lastDate.setHours(0, 0, 0, 0);

      // Check if the most recent quiz was today or yesterday
      const diffTime = Math.abs(today - lastDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        // Most recent was today or yesterday, count backwards
        for (let i = 0; i < uniqueDays.length - 1; i++) {
          let date1 = new Date(uniqueDays[i]);
          date1.setHours(0, 0, 0, 0);
          let date2 = new Date(uniqueDays[i+1]);
          date2.setHours(0, 0, 0, 0);
          
          const dayDiff = Math.ceil(Math.abs(date1 - date2) / (1000 * 60 * 60 * 24));
          if (dayDiff === 1) {
            currentStreak++;
          } else {
            break;
          }
        }
      } else {
        // Most recent quiz was more than 1 day ago, streak is broken
        currentStreak = 0;
      }
    }

    const stats = {
      totalQuestionsAnswered: totalQuestionsAnswered,
      averageScore: Math.round(avgScore),
      streak: currentStreak,
      subjectAccuracy: subjects.map(s => ({
        subject: s._id || 'General',
        accuracy: Math.round((s.avgAccuracy || 0) * 100)
      }))
    };

    console.log('Final Calculated Stats:', stats);
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
