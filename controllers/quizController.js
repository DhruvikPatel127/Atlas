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
      return res.status(401).json({ message: 'Unauthorized' });
    }

    console.log('--- STATS CALCULATION START ---');
    console.log('User ID from Token:', userId);

    let userObjectId;
    try {
      userObjectId = new mongoose.Types.ObjectId(userId);
    } catch (e) {
      console.log('User ID is not a valid ObjectId string');
    }

    // 1. Fetch ALL quizzes for this user using both potential ID formats for maximum compatibility
    const allUserQuizzes = await Quiz.find({ 
      $or: [
        { userId: userId },
        { userId: userObjectId }
      ].filter(q => q.userId !== undefined)
    }).sort({ createdAt: -1 });

    console.log(`Found ${allUserQuizzes.length} total quizzes for user.`);

    // 2. Separate quizzes with scores from those without
    const quizzesWithScores = allUserQuizzes.filter(q => q.score !== null && q.score !== undefined);
    console.log(`Found ${quizzesWithScores.length} quizzes with valid scores.`);

    let totalQuestionsAnswered = 0;
    let totalScoreSum = 0;
    let totalPossibleSum = 0;
    const subjectStats = {};

    quizzesWithScores.forEach((q) => {
      const qScore = typeof q.score === 'number' ? q.score : 0;
      
      // Determine total questions for this quiz
      let qTotal = q.totalQuestions;
      if (!qTotal || qTotal === 0) {
        qTotal = (q.questions && q.questions.length > 0) ? q.questions.length : 5;
      }
      
      totalQuestionsAnswered += qTotal;
      totalScoreSum += qScore;
      totalPossibleSum += qTotal;

      // Group by subject for accuracy
      const subj = q.subject || 'General';
      if (!subjectStats[subj]) {
        subjectStats[subj] = { score: 0, total: 0 };
      }
      subjectStats[subj].score += qScore;
      subjectStats[subj].total += qTotal;
    });

    // 3. Calculate Overall Accuracy
    const avgScore = totalPossibleSum > 0 ? (totalScoreSum / totalPossibleSum) * 100 : 0;

    // 4. Calculate Streak (Consecutive Days)
    const uniqueDays = [...new Set(
      quizzesWithScores
        .filter(q => q.createdAt)
        .map(q => new Date(q.createdAt).toDateString())
    )].sort((a, b) => new Date(b) - new Date(a));

    let currentStreak = 0;
    if (uniqueDays.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const lastQuizDate = new Date(uniqueDays[0]);
      lastQuizDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor(Math.abs(today - lastQuizDate) / (1000 * 60 * 60 * 24));

      if (diffDays <= 1) {
        currentStreak = 1;
        for (let i = 0; i < uniqueDays.length - 1; i++) {
          const d1 = new Date(uniqueDays[i]); d1.setHours(0,0,0,0);
          const d2 = new Date(uniqueDays[i+1]); d2.setHours(0,0,0,0);
          const gap = Math.floor(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
          if (gap === 1) currentStreak++;
          else break;
        }
      }
    }

    // 5. Format Subject Accuracy for Frontend
    const subjectAccuracy = Object.keys(subjectStats).map(subj => ({
      subject: subj,
      accuracy: Math.round((subjectStats[subj].score / subjectStats[subj].total) * 100)
    }));

    const stats = {
      totalQuestionsAnswered: quizzesWithScores.length, // Showing "Quizzes Solved" instead of "Questions Solved" might be clearer
      averageScore: Math.round(avgScore),
      streak: currentStreak,
      subjectAccuracy: subjectAccuracy,
      debug: {
        totalQuizzes: allUserQuizzes.length,
        scoredQuizzes: quizzesWithScores.length,
        totalQuestions: totalQuestionsAnswered
      }
    };

    console.log('Returning Stats:', JSON.stringify(stats));
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
