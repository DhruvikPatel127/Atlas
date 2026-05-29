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

    const prompt = `Create a 5-question multiple choice quiz about: ${note.content}. 
    Subject: ${note.subject || 'General'}.
    The response MUST be a JSON object with this structure:
    {"title": "Quiz Title", "subject": "Subject", "questions": [{"question": "Q", "options": ["A", "B", "C", "D"], "answer": "A"}]}`;

    const aiResponse = await generateContent(prompt, 'quiz', 1, true);
    
    let quizData;
    try {
      quizData = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Quiz JSON Parse Error. Raw AI Response:', aiResponse);
      throw new Error('AI generated an invalid quiz format. Please try again.');
    }

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

    console.log(`--- SUBMITTING SCORE ---`);
    console.log(`Quiz ID: ${quizId}, Score: ${score}, User: ${userId}`);

    // Update the quiz score. We use the same userId string from the token 
    // to match the document, just like in Note/getNotes.
    const quiz = await Quiz.findOneAndUpdate(
      { _id: quizId, userId: userId },
      { $set: { score: Number(score) } },
      { returnDocument: 'after' }
    );

    if (!quiz) {
      console.log(`Quiz not found or unauthorized.`);
      return res.status(404).json({ message: 'Quiz not found' });
    }
    
    console.log(`Score saved successfully. Quiz Subject: ${quiz.subject}`);
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

    console.log('--- PROGRESS STATS CALCULATION ---');
    console.log('User ID from request:', userId);

    // 1. Fetch ALL quizzes for this user. 
    // IMPORTANT: Some quizzes might have userId stored as a string, others as an ObjectId.
    // We'll search for both to be absolutely sure.
    const quizzes = await Quiz.find({ 
      $or: [
        { userId: userId },
        { userId: userId.toString() }
      ]
    }).sort({ createdAt: -1 });
    
    console.log(`Found ${quizzes.length} total quizzes in database for this user.`);

    // 2. Filter quizzes that have been completed (have a score)
    const completedQuizzes = quizzes.filter(q => q.score !== null && q.score !== undefined);
    console.log(`Found ${completedQuizzes.length} completed quizzes with scores.`);

    let totalQuestionsAnswered = 0;
    let totalCorrectAnswers = 0;
    const subjectStats = {};

    completedQuizzes.forEach(q => {
      const score = Number(q.score) || 0;
      const total = Number(q.totalQuestions) || (q.questions ? q.questions.length : 5);
      const subject = q.subject || 'General';

      totalQuestionsAnswered += total;
      totalCorrectAnswers += score;

      if (!subjectStats[subject]) {
        subjectStats[subject] = { totalScore: 0, totalQuestions: 0 };
      }
      subjectStats[subject].totalScore += score;
      subjectStats[subject].totalQuestions += total;
    });

    // Calculate Average Accuracy
    const averageScore = totalQuestionsAnswered > 0 
      ? Math.round((totalCorrectAnswers / totalQuestionsAnswered) * 100) 
      : 0;

    // Calculate Subject Mastery list
    const subjectAccuracy = Object.keys(subjectStats).map(subject => ({
      subject: subject,
      accuracy: Math.round((subjectStats[subject].totalScore / subjectStats[subject].totalQuestions) * 100)
    }));

    // 3. Calculate Streak (Consecutive days)
    const uniqueDays = [...new Set(
      completedQuizzes
        .map(q => new Date(q.createdAt).toDateString())
    )].map(d => new Date(d)).sort((a, b) => b - a); // Sort newest first

    let streak = 0;
    if (uniqueDays.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const lastQuizDate = uniqueDays[0];
      const diffTime = Math.abs(today - lastQuizDate);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // If last quiz was today or yesterday, start counting
      if (diffDays <= 1) {
        streak = 1;
        for (let i = 0; i < uniqueDays.length - 1; i++) {
          const d1 = uniqueDays[i];
          const d2 = uniqueDays[i + 1];
          const gap = Math.floor(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));
          
          if (gap === 1) {
            streak++;
          } else {
            break;
          }
        }
      }
    }

    const finalStats = {
      totalQuestionsAnswered: completedQuizzes.length, // Display "Solved" as number of quizzes
      averageScore: averageScore,
      streak: streak,
      subjectAccuracy: subjectAccuracy,
      debugInfo: {
        totalQuizzesInDb: quizzes.length,
        scoredQuizzes: completedQuizzes.length,
        userIdRequested: userId,
        dbUserIds: quizzes.slice(0, 5).map(q => q.userId) // Look at first few IDs in DB
      }
    };

    console.log('Final Stats response:', JSON.stringify(finalStats, null, 2));
    res.json(finalStats);

  } catch (error) {
    console.error('Stats Calculation Error:', error);
    res.status(500).json({ message: 'Error calculating stats', error: error.message });
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
